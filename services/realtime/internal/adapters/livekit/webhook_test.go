package livekit

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"
)

func signedWebhookToken(t *testing.T, secret string, claims map[string]any) string {
	t.Helper()
	token, err := signJWT(claims, []byte(secret))
	if err != nil {
		t.Fatalf("signJWT: %v", err)
	}

	return token
}

func TestWebhookVerifierAcceptsValidSignature(t *testing.T) {
	verifier, err := NewWebhookVerifier("lk_key", "lk_secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewWebhookVerifier: %v", err)
	}
	verifier.now = func() time.Time { return time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC) }

	body := []byte(`{"event":"egress_ended","egressInfo":{"egressId":"eg_1"}}`)
	digest := sha256.Sum256(body)
	token := signedWebhookToken(t, "lk_secret_long_enough_for_tests", map[string]any{
		"iss":    "lk_key",
		"exp":    time.Date(2026, 6, 23, 10, 5, 0, 0, time.UTC).Unix(),
		"sha256": base64.StdEncoding.EncodeToString(digest[:]),
	})

	if err := verifier.VerifyWebhook(token, body); err != nil {
		t.Fatalf("expected a valid webhook to verify, got %v", err)
	}
}

func TestWebhookVerifierRejectsTamperedBody(t *testing.T) {
	verifier, _ := NewWebhookVerifier("lk_key", "lk_secret_long_enough_for_tests")
	verifier.now = func() time.Time { return time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC) }

	body := []byte(`{"event":"egress_ended","egressInfo":{"egressId":"eg_1"}}`)
	digest := sha256.Sum256(body)
	token := signedWebhookToken(t, "lk_secret_long_enough_for_tests", map[string]any{
		"iss":    "lk_key",
		"sha256": base64.StdEncoding.EncodeToString(digest[:]),
	})

	tampered := []byte(`{"event":"egress_ended","egressInfo":{"egressId":"eg_OTHER"}}`)
	if err := verifier.VerifyWebhook(token, tampered); err == nil {
		t.Fatal("expected a tampered body to be rejected")
	}
}

func TestWebhookVerifierRejectsWrongSecret(t *testing.T) {
	verifier, _ := NewWebhookVerifier("lk_key", "the_real_secret_long_enough")
	verifier.now = func() time.Time { return time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC) }

	body := []byte(`{"event":"egress_ended"}`)
	digest := sha256.Sum256(body)
	token := signedWebhookToken(t, "a_different_secret_long_enough", map[string]any{
		"iss":    "lk_key",
		"sha256": base64.StdEncoding.EncodeToString(digest[:]),
	})

	if err := verifier.VerifyWebhook(token, body); err == nil {
		t.Fatal("expected a token signed with the wrong secret to be rejected")
	}
}
