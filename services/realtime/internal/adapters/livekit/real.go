package livekit

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

const (
	joinTTL  = 15 * time.Minute
	adminTTL = 5 * time.Minute
)

type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

type RealGateway struct {
	url        string
	apiKey     string
	apiSecret  string
	now        func() time.Time
	httpClient httpDoer
	egress     *EgressTarget
}

// EgressTarget is the S3-compatible object-storage destination (Cloudflare R2)
// that LiveKit Egress writes the recorded audio to. ForcePathStyle is always
// sent because R2 requires path-style addressing.
type EgressTarget struct {
	Bucket    string
	Region    string
	Endpoint  string
	AccessKey string
	Secret    string
}

// ConfigureEgress enables audio recording on the gateway by setting the R2
// destination. Until it is called, StartRoomCompositeEgress refuses to run.
func (g *RealGateway) ConfigureEgress(target EgressTarget) {
	g.egress = &target
}

func NewRealGateway(url string, apiKey string, apiSecret string) (*RealGateway, error) {
	url = strings.TrimSpace(url)
	apiKey = strings.TrimSpace(apiKey)
	apiSecret = strings.TrimSpace(apiSecret)
	if url == "" {
		return nil, fmt.Errorf("livekit url is required")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("livekit api key is required")
	}
	if apiSecret == "" {
		return nil, fmt.Errorf("livekit api secret is required")
	}

	return &RealGateway{
		url:        url,
		apiKey:     apiKey,
		apiSecret:  apiSecret,
		now:        func() time.Time { return time.Now().UTC() },
		httpClient: http.DefaultClient,
	}, nil
}

// NewGatewayFromEnv builds the live gateway. When requireReal is true (production)
// and any credential is missing, it returns an error so the service fails fast
// rather than silently degrading to the mock gateway — which fabricates
// non-functional "mock_lk_" tokens and would let a candidate sit through a fake,
// audio-less interview. Outside production, missing credentials fall back to mock.
func NewGatewayFromEnv(url string, apiKey string, apiSecret string, requireReal bool) (application.LiveKitGateway, string, error) {
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(apiSecret) == "" {
		if requireReal {
			return nil, "", fmt.Errorf("livekit credentials are required in production")
		}
		return NewMockGateway(url), "mock", nil
	}

	gateway, err := NewRealGateway(url, apiKey, apiSecret)
	if err != nil {
		return nil, "", err
	}
	return gateway, "real", nil
}

func (g *RealGateway) CreateJoin(_ context.Context, input application.LiveKitJoinInput) (application.LiveKitJoin, error) {
	roomName := strings.TrimSpace(input.RoomName)
	participant := strings.TrimSpace(input.Participant)
	if roomName == "" {
		return application.LiveKitJoin{}, fmt.Errorf("livekit room name is required")
	}
	if participant == "" {
		return application.LiveKitJoin{}, fmt.Errorf("livekit participant is required")
	}

	token, err := g.mintJoinToken(participant, roomName)
	if err != nil {
		return application.LiveKitJoin{}, err
	}

	return application.LiveKitJoin{
		RoomName:    roomName,
		URL:         g.url,
		Token:       token,
		Participant: participant,
		ExpiresAt:   g.now().Add(joinTTL),
	}, nil
}

func (g *RealGateway) EnsureRoom(ctx context.Context, input application.EnsureRoomInput) error {
	roomName := strings.TrimSpace(input.RoomName)
	if roomName == "" {
		return fmt.Errorf("livekit room name is required")
	}

	token, err := g.mintAdminToken()
	if err != nil {
		return err
	}

	body, err := json.Marshal(map[string]any{
		"name":             roomName,
		"empty_timeout":    uint32(input.EmptyTimeout.Seconds()),
		"max_participants": input.MaxParticipants,
	})
	if err != nil {
		return err
	}

	endpoint := httpBaseURL(g.url) + "/twirp/livekit.RoomService/CreateRoom"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")

	response, err := g.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	// CreateRoom is idempotent server-side: an existing room returns 200, so a
	// retry or duplicate session-creation attempt is safe.
	if response.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return fmt.Errorf("livekit create room failed with HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(snippet)))
	}

	return nil
}

// mintAdminToken signs a short-lived control-plane token granting roomCreate +
// roomAdmin. Room creation is done with THIS admin credential, never with a
// participant join token — candidate/agent tokens deliberately lack roomCreate.
func (g *RealGateway) mintAdminToken() (string, error) {
	now := g.now()
	claims := map[string]any{
		"iss": g.apiKey,
		"sub": "prelude-realtime-control-plane",
		"nbf": now.Unix(),
		"exp": now.Add(adminTTL).Unix(),
		"video": map[string]any{
			"roomCreate": true,
			"roomAdmin":  true,
		},
	}
	return signJWT(claims, []byte(g.apiSecret))
}

// StartRoomCompositeEgress starts an audio-only room-composite egress that mixes
// every participant's audio into a single OGG/Opus file written straight to R2.
// It hand-rolls the Twirp call exactly like EnsureRoom (no LiveKit SDK), reusing
// the httpDoer seam, and authorizes with a narrow roomRecord token.
func (g *RealGateway) StartRoomCompositeEgress(ctx context.Context, input application.StartEgressInput) (application.EgressHandle, error) {
	if g.egress == nil {
		return application.EgressHandle{}, fmt.Errorf("livekit egress target is not configured")
	}
	roomName := strings.TrimSpace(input.RoomName)
	if roomName == "" {
		return application.EgressHandle{}, fmt.Errorf("livekit room name is required")
	}
	objectKey := strings.TrimSpace(input.ObjectKey)
	if objectKey == "" {
		return application.EgressHandle{}, fmt.Errorf("livekit egress object key is required")
	}

	token, err := g.mintEgressToken()
	if err != nil {
		return application.EgressHandle{}, err
	}

	// Field names are the proto names (snake_case); protojson accepts them on the
	// wire, matching how EnsureRoom encodes its CreateRoom request.
	payload := map[string]any{
		"room_name":  roomName,
		"audio_only": true,
		"file_outputs": []map[string]any{
			{
				"file_type": egressFileType(input.Format),
				"filepath":  objectKey,
				"s3": map[string]any{
					"bucket":           g.egress.Bucket,
					"region":           g.egress.Region,
					"access_key":       g.egress.AccessKey,
					"secret":           g.egress.Secret,
					"endpoint":         g.egress.Endpoint,
					"force_path_style": true,
				},
			},
		},
	}

	responseBody, err := g.doTwirp(ctx, "/twirp/livekit.Egress/StartRoomCompositeEgress", token, payload)
	if err != nil {
		return application.EgressHandle{}, err
	}

	// LiveKit's protojson responses are camelCase by default; tolerate the proto
	// field name too in case the server is configured to emit it.
	var parsed struct {
		EgressID      string `json:"egressId"`
		EgressIDProto string `json:"egress_id"`
	}
	if err := json.Unmarshal(responseBody, &parsed); err != nil {
		return application.EgressHandle{}, fmt.Errorf("decode egress response: %w", err)
	}
	egressID := firstNonBlank(parsed.EgressID, parsed.EgressIDProto)
	if egressID == "" {
		return application.EgressHandle{}, fmt.Errorf("livekit egress response missing egress id")
	}

	return application.EgressHandle{EgressID: egressID}, nil
}

// StopEgress ends an in-flight egress so the recording finalizes promptly. It is
// best-effort at the call site; LiveKit also auto-stops on room close.
func (g *RealGateway) StopEgress(ctx context.Context, egressID string) error {
	egressID = strings.TrimSpace(egressID)
	if egressID == "" {
		return fmt.Errorf("livekit egress id is required")
	}

	token, err := g.mintEgressToken()
	if err != nil {
		return err
	}

	if _, err := g.doTwirp(ctx, "/twirp/livekit.Egress/StopEgress", token, map[string]any{"egress_id": egressID}); err != nil {
		return err
	}

	return nil
}

// mintEgressToken signs a short-lived control-plane token whose only grant is
// roomRecord — deliberately narrower than the room-admin token, following the
// least-privilege pattern already used for join and admin tokens.
func (g *RealGateway) mintEgressToken() (string, error) {
	now := g.now()
	claims := map[string]any{
		"iss": g.apiKey,
		"sub": "prelude-realtime-egress",
		"nbf": now.Unix(),
		"exp": now.Add(adminTTL).Unix(),
		"video": map[string]any{
			"roomRecord": true,
		},
	}
	return signJWT(claims, []byte(g.apiSecret))
}

func (g *RealGateway) doTwirp(ctx context.Context, path string, token string, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, httpBaseURL(g.url)+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")

	response, err := g.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()

	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 1<<16))
	if response.StatusCode >= 300 {
		return nil, fmt.Errorf("livekit %s failed with HTTP %d: %s", path, response.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	return responseBody, nil
}

func egressFileType(format string) string {
	switch format {
	case "audio/ogg":
		return "OGG"
	default:
		return "OGG"
	}
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}

// httpBaseURL converts a LiveKit client URL (wss://host / ws://host) to its HTTP
// server-API base (https://host / http://host) for Twirp room-service calls.
func httpBaseURL(rawURL string) string {
	switch {
	case strings.HasPrefix(rawURL, "wss://"):
		return "https://" + strings.TrimPrefix(rawURL, "wss://")
	case strings.HasPrefix(rawURL, "ws://"):
		return "http://" + strings.TrimPrefix(rawURL, "ws://")
	default:
		return rawURL
	}
}

func (g *RealGateway) mintJoinToken(participant string, roomName string) (string, error) {
	now := g.now()
	claims := map[string]any{
		"iss":  g.apiKey,
		"sub":  participant,
		"name": participant,
		"nbf":  now.Unix(),
		"exp":  now.Add(joinTTL).Unix(),
		"video": map[string]any{
			"roomJoin":       true,
			"room":           roomName,
			"canPublish":     true,
			"canSubscribe":   true,
			"canPublishData": true,
			"agent":          strings.HasPrefix(participant, "agent-"),
		},
	}
	return signJWT(claims, []byte(g.apiSecret))
}

func signJWT(claims map[string]any, secret []byte) (string, error) {
	header, err := json.Marshal(map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := encodedHeader + "." + encodedPayload
	mac := hmac.New(sha256.New, secret)
	if _, err := mac.Write([]byte(unsigned)); err != nil {
		return "", err
	}
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return unsigned + "." + signature, nil
}
