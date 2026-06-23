package livekit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// WebhookVerifier authenticates inbound LiveKit webhooks (e.g. egress_ended).
// LiveKit signs each webhook with an HS256 JWT in the Authorization header whose
// `sha256` claim is the base64 digest of the raw request body, signed with the
// API secret. This is the inbound counterpart to the outbound token signing in
// real.go — the service only ever signed before; verification is net-new.
type WebhookVerifier struct {
	apiKey    string
	apiSecret string
	now       func() time.Time
}

func NewWebhookVerifier(apiKey string, apiSecret string) (*WebhookVerifier, error) {
	apiKey = strings.TrimSpace(apiKey)
	apiSecret = strings.TrimSpace(apiSecret)
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("livekit webhook credentials are required")
	}

	return &WebhookVerifier{
		apiKey:    apiKey,
		apiSecret: apiSecret,
		now:       func() time.Time { return time.Now().UTC() },
	}, nil
}

// VerifyWebhook returns nil only when the Authorization token is a valid LiveKit
// webhook JWT for exactly this body. It checks the HMAC signature, the issuer,
// expiry, and that the body hash matches the signed `sha256` claim — so a
// tampered body or a replayed token for a different payload is rejected.
func (v *WebhookVerifier) VerifyWebhook(authHeader string, body []byte) error {
	token := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(authHeader), "Bearer "))
	if token == "" {
		return fmt.Errorf("missing webhook authorization token")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return fmt.Errorf("malformed webhook token")
	}

	mac := hmac.New(sha256.New, []byte(v.apiSecret))
	if _, err := mac.Write([]byte(parts[0] + "." + parts[1])); err != nil {
		return err
	}
	expectedSignature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expectedSignature), []byte(parts[2])) {
		return fmt.Errorf("webhook signature mismatch")
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("decode webhook claims: %w", err)
	}
	var claims struct {
		Iss    string `json:"iss"`
		Exp    int64  `json:"exp"`
		Sha256 string `json:"sha256"`
	}
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return fmt.Errorf("decode webhook claims: %w", err)
	}

	if claims.Iss != "" && claims.Iss != v.apiKey {
		return fmt.Errorf("webhook issuer mismatch")
	}
	if claims.Exp > 0 && v.now().After(time.Unix(claims.Exp, 0)) {
		return fmt.Errorf("webhook token expired")
	}

	digest := sha256.Sum256(body)
	expectedHash := base64.StdEncoding.EncodeToString(digest[:])
	if claims.Sha256 == "" || !hmac.Equal([]byte(claims.Sha256), []byte(expectedHash)) {
		return fmt.Errorf("webhook body hash mismatch")
	}

	return nil
}
