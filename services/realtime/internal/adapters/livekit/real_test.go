package livekit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

func TestNewGatewayFromEnvFallsBackToMockWithoutCredentials(t *testing.T) {
	gateway, mode, err := NewGatewayFromEnv("wss://livekit.example.test", "", "", false)
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

func TestNewGatewayFromEnvFailsFastInProductionWithoutCredentials(t *testing.T) {
	_, _, err := NewGatewayFromEnv("wss://livekit.example.test", "", "", true)
	if err == nil {
		t.Fatal("expected error in production without livekit credentials")
	}
}

type stubDoer struct {
	request      *http.Request
	body         []byte
	status       int
	responseBody string
	err          error
}

func (s *stubDoer) Do(req *http.Request) (*http.Response, error) {
	s.request = req
	if req.Body != nil {
		s.body, _ = io.ReadAll(req.Body)
	}
	if s.err != nil {
		return nil, s.err
	}

	responseBody := s.responseBody
	if responseBody == "" {
		responseBody = "{}"
	}

	return &http.Response{
		StatusCode: s.status,
		Body:       io.NopCloser(strings.NewReader(responseBody)),
	}, nil
}

func TestRealGatewayEnsureRoomCreatesRoomWithAdminToken(t *testing.T) {
	gateway, err := NewRealGateway(
		"wss://livekit.example.test",
		"livekit_key",
		"livekit_secret_that_is_long_enough_for_tests",
	)
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.now = func() time.Time { return time.Date(2026, 6, 18, 10, 0, 0, 0, time.UTC) }
	stub := &stubDoer{status: http.StatusOK}
	gateway.httpClient = stub

	if err := gateway.EnsureRoom(context.Background(), application.EnsureRoomInput{
		RoomName:        "prelude-is_test",
		EmptyTimeout:    5 * time.Minute,
		MaxParticipants: 2,
	}); err != nil {
		t.Fatalf("EnsureRoom returned error: %v", err)
	}

	if stub.request == nil {
		t.Fatal("expected a CreateRoom request to be issued")
	}
	if got := stub.request.URL.String(); got != "https://livekit.example.test/twirp/livekit.RoomService/CreateRoom" {
		t.Fatalf("unexpected create-room endpoint: %s", got)
	}

	auth := stub.request.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		t.Fatalf("expected bearer auth, got %q", auth)
	}
	token := strings.TrimPrefix(auth, "Bearer ")
	if strings.Contains(token, "livekit_secret_that_is_long_enough_for_tests") {
		t.Fatal("admin token must not contain the LiveKit API secret")
	}

	claims := decodeJWTClaims(t, token)
	video, ok := claims["video"].(map[string]any)
	if !ok {
		t.Fatalf("expected video grant in admin token: %#v", claims)
	}
	if video["roomCreate"] != true || video["roomAdmin"] != true {
		t.Fatalf("expected roomCreate+roomAdmin grants, got %#v", video)
	}
	if !strings.Contains(string(stub.body), `"prelude-is_test"`) {
		t.Fatalf("expected room name in request body, got %s", string(stub.body))
	}
}

func TestRealGatewayEnsureRoomReturnsErrorOnHTTPFailure(t *testing.T) {
	gateway, err := NewRealGateway("wss://livekit.example.test", "k", "secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.httpClient = &stubDoer{status: http.StatusInternalServerError}

	if err := gateway.EnsureRoom(context.Background(), application.EnsureRoomInput{
		RoomName:        "prelude-x",
		MaxParticipants: 2,
	}); err == nil {
		t.Fatal("expected error on HTTP 500")
	}
}

func TestRealGatewayJoinTokenDoesNotGrantRoomCreate(t *testing.T) {
	gateway, err := NewRealGateway("wss://livekit.example.test", "k", "secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}

	join, err := gateway.CreateJoin(context.Background(), application.LiveKitJoinInput{
		SessionID:   "is_x",
		RoomName:    "prelude-is_x",
		Participant: "candidate-x",
	})
	if err != nil {
		t.Fatalf("CreateJoin returned error: %v", err)
	}

	claims := decodeJWTClaims(t, join.Token)
	video, _ := claims["video"].(map[string]any)
	if _, ok := video["roomCreate"]; ok {
		t.Fatalf("join token must NOT grant roomCreate, got %#v", video)
	}
}

func TestRealGatewayStartRoomCompositeEgressRecordsAudioToR2(t *testing.T) {
	gateway, err := NewRealGateway("wss://livekit.example.test", "livekit_key", "livekit_signing_secret_long_enough")
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.now = func() time.Time { return time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC) }
	gateway.ConfigureEgress(EgressTarget{
		Bucket:    "prelude-recordings",
		Region:    "auto",
		Endpoint:  "https://acct.r2.cloudflarestorage.com",
		AccessKey: "r2_access_key",
		Secret:    "r2_secret_value",
	})
	stub := &stubDoer{status: http.StatusOK, responseBody: `{"egressId":"eg_live_1"}`}
	gateway.httpClient = stub

	handle, err := gateway.StartRoomCompositeEgress(context.Background(), application.StartEgressInput{
		RoomName:  "prelude-is_test",
		ObjectKey: "recordings/is_test/123.ogg",
	})
	if err != nil {
		t.Fatalf("StartRoomCompositeEgress returned error: %v", err)
	}
	if handle.EgressID != "eg_live_1" {
		t.Fatalf("expected egress id eg_live_1, got %s", handle.EgressID)
	}

	if got := stub.request.URL.String(); got != "https://livekit.example.test/twirp/livekit.Egress/StartRoomCompositeEgress" {
		t.Fatalf("unexpected egress endpoint: %s", got)
	}

	token := strings.TrimPrefix(stub.request.Header.Get("Authorization"), "Bearer ")
	claims := decodeJWTClaims(t, token)
	video, ok := claims["video"].(map[string]any)
	if !ok {
		t.Fatalf("expected video grant in egress token: %#v", claims)
	}
	if video["roomRecord"] != true {
		t.Fatalf("expected roomRecord grant, got %#v", video)
	}
	if _, ok := video["roomCreate"]; ok {
		t.Fatalf("egress token must NOT grant roomCreate, got %#v", video)
	}

	body := string(stub.body)
	for _, want := range []string{
		`"audio_only":true`,
		`"recordings/is_test/123.ogg"`,
		`"force_path_style":true`,
		`"prelude-recordings"`,
		`"https://acct.r2.cloudflarestorage.com"`,
		`"OGG"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected egress body to contain %s, got %s", want, body)
		}
	}
	if strings.Contains(body, "livekit_signing_secret_long_enough") {
		t.Fatal("egress request must not contain the LiveKit signing secret")
	}
}

func TestRealGatewayStartRoomCompositeEgressRequiresTarget(t *testing.T) {
	gateway, err := NewRealGateway("wss://livekit.example.test", "k", "secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.httpClient = &stubDoer{status: http.StatusOK}

	if _, err := gateway.StartRoomCompositeEgress(context.Background(), application.StartEgressInput{
		RoomName:  "prelude-x",
		ObjectKey: "recordings/x/1.ogg",
	}); err == nil {
		t.Fatal("expected error when egress target is not configured")
	}
}

func TestRealGatewayStartRoomCompositeEgressErrorsOnHTTPFailure(t *testing.T) {
	gateway, err := NewRealGateway("wss://livekit.example.test", "k", "secret_long_enough_for_tests")
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.ConfigureEgress(EgressTarget{Bucket: "b", Region: "auto", Endpoint: "https://e", AccessKey: "a", Secret: "s"})
	gateway.httpClient = &stubDoer{status: http.StatusInternalServerError}

	if _, err := gateway.StartRoomCompositeEgress(context.Background(), application.StartEgressInput{
		RoomName:  "prelude-x",
		ObjectKey: "recordings/x/1.ogg",
	}); err == nil {
		t.Fatal("expected error on HTTP 500")
	}
}

func TestRealGatewayStopEgressTargetsTheEgressID(t *testing.T) {
	gateway, err := NewRealGateway("wss://livekit.example.test", "livekit_key", "livekit_signing_secret_long_enough")
	if err != nil {
		t.Fatalf("NewRealGateway returned error: %v", err)
	}
	gateway.now = func() time.Time { return time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC) }
	stub := &stubDoer{status: http.StatusOK}
	gateway.httpClient = stub

	if err := gateway.StopEgress(context.Background(), "eg_live_1"); err != nil {
		t.Fatalf("StopEgress returned error: %v", err)
	}
	if got := stub.request.URL.String(); got != "https://livekit.example.test/twirp/livekit.Egress/StopEgress" {
		t.Fatalf("unexpected stop endpoint: %s", got)
	}
	if !strings.Contains(string(stub.body), `"eg_live_1"`) {
		t.Fatalf("expected egress id in stop body, got %s", string(stub.body))
	}
	token := strings.TrimPrefix(stub.request.Header.Get("Authorization"), "Bearer ")
	claims := decodeJWTClaims(t, token)
	if video, _ := claims["video"].(map[string]any); video["roomRecord"] != true {
		t.Fatalf("expected roomRecord grant on stop, got %#v", claims["video"])
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
