package livekit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

const joinTTL = 15 * time.Minute

type RealGateway struct {
	url       string
	apiKey    string
	apiSecret string
	now       func() time.Time
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
		url:       url,
		apiKey:    apiKey,
		apiSecret: apiSecret,
		now:       func() time.Time { return time.Now().UTC() },
	}, nil
}

func NewGatewayFromEnv(url string, apiKey string, apiSecret string) (application.LiveKitGateway, string, error) {
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(apiSecret) == "" {
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
