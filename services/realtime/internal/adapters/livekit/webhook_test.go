package livekit

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/livekit/protocol/auth"
)

func signedWebhookRequest(t *testing.T, apiKey string, secret string, body string) *http.Request {
	t.Helper()
	digest := sha256.Sum256([]byte(body))
	token, err := auth.NewAccessToken(apiKey, secret).
		SetSha256(base64.StdEncoding.EncodeToString(digest[:])).
		ToJWT()
	if err != nil {
		t.Fatalf("sign webhook token: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/livekit/egress-webhook", strings.NewReader(body))
	request.Header.Set("Authorization", token)
	request.Header.Set("Content-Type", "application/webhook+json")
	return request
}

func TestWebhookParserMapsVerifiedEgressEnded(t *testing.T) {
	parser, err := NewWebhookParser("lk_key", "lk_secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewWebhookParser: %v", err)
	}

	body := `{"event":"egress_ended","egressInfo":{"egressId":"eg_1","status":"EGRESS_COMPLETE","fileResults":[{"duration":"180000000000"}]}}`
	request := signedWebhookRequest(t, "lk_key", "lk_secret_long_enough_for_tests", body)

	finalize, ok, err := parser.ParseEgressEnded(request)
	if err != nil {
		t.Fatalf("ParseEgressEnded returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected egress_ended to be handled")
	}
	if finalize.EgressID != "eg_1" {
		t.Fatalf("expected egress id eg_1, got %s", finalize.EgressID)
	}
	if finalize.Status != "EGRESS_COMPLETE" {
		t.Fatalf("expected EGRESS_COMPLETE, got %s", finalize.Status)
	}
	if finalize.DurationMs == nil || *finalize.DurationMs != 180000 {
		t.Fatalf("expected 180000ms, got %v", finalize.DurationMs)
	}
}

func TestWebhookParserRejectsWrongSecret(t *testing.T) {
	parser, err := NewWebhookParser("lk_key", "the_real_secret_long_enough")
	if err != nil {
		t.Fatalf("NewWebhookParser: %v", err)
	}

	body := `{"event":"egress_ended","egressInfo":{"egressId":"eg_1"}}`
	request := signedWebhookRequest(t, "lk_key", "a_different_secret_long_enough", body)

	if _, _, err := parser.ParseEgressEnded(request); err == nil {
		t.Fatal("expected verification to fail for a token signed with the wrong secret")
	}
}

func TestWebhookParserIgnoresNonEgressEvent(t *testing.T) {
	parser, err := NewWebhookParser("lk_key", "lk_secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewWebhookParser: %v", err)
	}

	body := `{"event":"room_started"}`
	request := signedWebhookRequest(t, "lk_key", "lk_secret_long_enough_for_tests", body)

	finalize, ok, err := parser.ParseEgressEnded(request)
	if err != nil {
		t.Fatalf("ParseEgressEnded returned error: %v", err)
	}
	if ok {
		t.Fatalf("expected a non-egress event to be ignored, got %+v", finalize)
	}
}
