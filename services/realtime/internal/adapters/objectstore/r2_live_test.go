package objectstore

import (
	"bytes"
	"context"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// TestR2StoreDeleteObjectLiveRoundtrip exercises the real adapter against the
// configured R2 bucket: it uploads a throwaway object, deletes it through
// R2Store.DeleteObject (the code that runs in production erasure), and confirms
// it is gone — proving the S3 API token actually has object DELETE permission
// (egress only ever proved PUT). Gated on EGRESS_R2_SMOKE=1 + the EGRESS_R2_*
// creds, like the Postgres integration tests, so it never runs in CI.
func TestR2StoreDeleteObjectLiveRoundtrip(t *testing.T) {
	if os.Getenv("EGRESS_R2_SMOKE") == "" {
		t.Skip("set EGRESS_R2_SMOKE=1 (and EGRESS_R2_* creds) to run the live R2 delete smoke")
	}

	cfg := Config{
		Bucket:    os.Getenv("EGRESS_R2_BUCKET"),
		Region:    os.Getenv("EGRESS_R2_REGION"),
		Endpoint:  os.Getenv("EGRESS_R2_ENDPOINT"),
		AccessKey: os.Getenv("EGRESS_R2_ACCESS_KEY_ID"),
		Secret:    os.Getenv("EGRESS_R2_SECRET_ACCESS_KEY"),
	}
	if cfg.Bucket == "" || cfg.Endpoint == "" || cfg.AccessKey == "" || cfg.Secret == "" {
		t.Fatal("EGRESS_R2_BUCKET/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY must be set")
	}

	ctx := context.Background()
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

	key := "smoke/delete-roundtrip-" + time.Now().UTC().Format("20060102150405.000000000") + ".txt"
	if _, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader([]byte("prelude r2 delete smoke")),
	}); err != nil {
		t.Fatalf("PutObject failed (token lacks object write?): %v", err)
	}
	t.Logf("put %s", key)

	// The code under test: the production erasure adapter.
	store := NewR2Store(cfg)
	if err := store.DeleteObject(ctx, key); err != nil {
		t.Fatalf("DeleteObject failed — the S3 token likely lacks object DELETE permission: %v", err)
	}
	t.Logf("deleted %s via R2Store.DeleteObject", key)

	// Confirm the object is actually gone (any error on Head = absent).
	if _, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
	}); err == nil {
		t.Fatal("object still present after DeleteObject — the delete did not take effect")
	}
	t.Logf("confirmed gone")

	// Live idempotency: deleting an already-absent key must still succeed.
	if err := store.DeleteObject(ctx, key); err != nil {
		t.Fatalf("second DeleteObject (idempotency) failed: %v", err)
	}
}
