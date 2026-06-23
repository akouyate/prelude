package objectstore

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type fakeS3 struct {
	err   error
	calls []*s3.DeleteObjectInput
}

func (f *fakeS3) DeleteObject(_ context.Context, in *s3.DeleteObjectInput, _ ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	f.calls = append(f.calls, in)
	return &s3.DeleteObjectOutput{}, f.err
}

func TestR2StoreDeleteObjectTargetsBucketAndKey(t *testing.T) {
	fake := &fakeS3{}
	store := newR2Store(fake, "prelude-interview-recordings")

	if err := store.DeleteObject(context.Background(), "recordings/is_1/1.ogg"); err != nil {
		t.Fatalf("DeleteObject returned error: %v", err)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected one DeleteObject call, got %d", len(fake.calls))
	}
	if got := *fake.calls[0].Bucket; got != "prelude-interview-recordings" {
		t.Fatalf("unexpected bucket %q", got)
	}
	if got := *fake.calls[0].Key; got != "recordings/is_1/1.ogg" {
		t.Fatalf("unexpected key %q", got)
	}
}

func TestR2StoreDeleteObjectIsIdempotentOnMissingObject(t *testing.T) {
	// Erasure must be safe to retry: a key that is already gone is success, not an
	// error, so a re-run of the retention sweep never wedges on a deleted object.
	fake := &fakeS3{err: &types.NoSuchKey{}}
	store := newR2Store(fake, "bucket")

	if err := store.DeleteObject(context.Background(), "recordings/is_1/1.ogg"); err != nil {
		t.Fatalf("expected a missing object to be treated as success, got %v", err)
	}
}

func TestR2StoreDeleteObjectPropagatesRealErrors(t *testing.T) {
	fake := &fakeS3{err: errors.New("access denied")}
	store := newR2Store(fake, "bucket")

	if err := store.DeleteObject(context.Background(), "recordings/is_1/1.ogg"); err == nil {
		t.Fatal("expected a non-not-found error to propagate")
	}
}

func TestR2StoreDeleteObjectNoOpOnEmptyKey(t *testing.T) {
	fake := &fakeS3{}
	store := newR2Store(fake, "bucket")

	if err := store.DeleteObject(context.Background(), ""); err != nil {
		t.Fatalf("empty key should be a no-op, got %v", err)
	}
	if len(fake.calls) != 0 {
		t.Fatal("empty key must not call S3 DeleteObject")
	}
}
