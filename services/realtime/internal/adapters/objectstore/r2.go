// Package objectstore deletes interview recording audio objects from Cloudflare
// R2 over the S3 API. It backs the retention sweep and recruiter erasure: the Go
// realtime service owns deletion because it owns the recording table and the
// reconciliation ticker, so the console never needs object-delete credentials.
package objectstore

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithy "github.com/aws/smithy-go"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

var _ application.ObjectStore = (*R2Store)(nil)

// Config is the R2 (S3-compatible) object storage configuration. It mirrors the
// LiveKit egress destination so deletes target the same bucket egress wrote to.
type Config struct {
	Bucket    string
	Region    string
	Endpoint  string
	AccessKey string
	Secret    string
}

// s3DeleteAPI is the narrow slice of the S3 client the store needs, so the delete
// semantics can be unit-tested with a fake instead of a live bucket.
type s3DeleteAPI interface {
	DeleteObject(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

// R2Store deletes recording objects from Cloudflare R2 over the S3 API.
type R2Store struct {
	client s3DeleteAPI
	bucket string
}

func newR2Store(client s3DeleteAPI, bucket string) *R2Store {
	return &R2Store{client: client, bucket: bucket}
}

// NewR2Store builds an R2Store from static R2 credentials and a custom endpoint,
// using path-style addressing (an R2 requirement), mirroring how the console
// signs playback URLs.
func NewR2Store(cfg Config) *R2Store {
	region := cfg.Region
	if region == "" {
		region = "auto"
	}
	client := s3.New(s3.Options{
		Region:       region,
		BaseEndpoint: aws.String(cfg.Endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.Secret, ""),
		UsePathStyle: true,
	})

	return newR2Store(client, cfg.Bucket)
}

// DeleteObject removes the object at key. An empty key is a no-op.
func (s *R2Store) DeleteObject(ctx context.Context, key string) error {
	if key == "" {
		return nil
	}

	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err == nil {
		return nil
	}

	// Deletion is idempotent: an object that is already gone is success. S3
	// DeleteObject normally returns 204 even for a missing key, but treat an
	// explicit not-found (typed or by API error code) as success too, so retries
	// of the retention sweep or an erasure request never wedge.
	var noSuchKey *types.NoSuchKey
	if errors.As(err, &noSuchKey) {
		return nil
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NotFound", "404":
			return nil
		}
	}

	return err
}
