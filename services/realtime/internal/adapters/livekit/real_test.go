package livekit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

func TestNewGatewayFromEnvFallsBackToMockWithoutCredentials(t *testing.T) {
	gateway, mode, err := NewGatewayFromEnv("wss://livekit.example.test", "", "")
	if err != nil {
		t.Fatalf("NewGatewayFromEnv returned error: %v", err)
	}
	if mode != "mock" {
		t.Fatalf("expected mock mode, got %s", mode)
	}

	join, err := gateway.CreateJoin(context.Background(), application.LiveKitJoinInput{
		SessionID:   "is_test",
		RoomName:    "prelude-is_test",
		Participant: "candidate-demo",
	})
	if err != nil {
		t.Fatalf("CreateJoin returned error: %v", err)
	}
	if !strings.HasPrefix(join.Token, "mock_lk_") {
		t.Fatalf("expected mock token, got %s", join.Token)
	}
}

func TestRealGatewayMintsJoinTokenWithoutLeakingSecret(t *testing.T) {
	gateway, err := NewRealGateway(
		"wss://livekit.example.test",
		"livekit_key",
		"livekit_secret_that_is_long_enough_for_tests",
	)
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.now = func() time.Time {
		return time.Date(2026, 6, 18, 10, 0, 0, 0, time.UTC)
	}

	join, err := gateway.CreateJoin(context.Background(), application.LiveKitJoinInput{
		SessionID:   "is_test",
		RoomName:    "prelude-is_test",
		Participant: "agent-is_test",
	})
	if err != nil {
		t.Fatalf("CreateJoin returned error: %v", err)
	}

	if join.URL != "wss://livekit.example.test" {
		t.Fatalf("expected livekit url, got %s", join.URL)
	}
	if join.RoomName != "prelude-is_test" {
		t.Fatalf("expected room, got %s", join.RoomName)
	}
	if join.Participant != "agent-is_test" {
		t.Fatalf("expected participant, got %s", join.Participant)
	}
	if strings.HasPrefix(join.Token, "mock_lk_") {
		t.Fatal("expected real JWT token")
	}
	if strings.Contains(join.Token, "livekit_secret_that_is_long_enough_for_tests") {
		t.Fatal("token must not contain the LiveKit API secret")
	}
	if !join.ExpiresAt.Equal(time.Date(2026, 6, 18, 10, 15, 0, 0, time.UTC)) {
		t.Fatalf("expected 15 minute expiry, got %s", join.ExpiresAt)
	}

	claims := decodeJWTClaims(t, join.Token)
	video, ok := claims["video"].(map[string]any)
	if !ok {
		t.Fatalf("expected video grant in claims: %#v", claims)
	}
	if claims["iss"] != "livekit_key" {
		t.Fatalf("expected api key issuer, got %#v", claims["iss"])
	}
	if claims["sub"] != "agent-is_test" {
		t.Fatalf("expected participant identity, got %#v", claims["sub"])
	}
	if video["room"] != "prelude-is_test" {
		t.Fatalf("expected room grant, got %#v", video["room"])
	}
	if video["roomJoin"] != true {
		t.Fatalf("expected roomJoin grant, got %#v", video["roomJoin"])
	}
	if video["agent"] != true {
		t.Fatalf("expected agent grant, got %#v", video["agent"])
	}
}

func decodeJWTClaims(t *testing.T, token string) map[string]any {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("expected JWT with 3 parts, got %d", len(parts))
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("failed to decode JWT payload: %v", err)
	}

	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("failed to unmarshal JWT payload: %v", err)
	}
	return claims
}
