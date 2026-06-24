package livekit

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

// WebhookParser verifies inbound LiveKit webhooks and extracts egress_ended
// finalization data, using the official protocol/webhook verifier (LiveKit signs
// each webhook with an HS256 JWT whose sha256 claim is the digest of the body).
type WebhookParser struct {
	provider auth.KeyProvider
}

func NewWebhookParser(apiKey string, apiSecret string) (*WebhookParser, error) {
	apiKey = strings.TrimSpace(apiKey)
	apiSecret = strings.TrimSpace(apiSecret)
	if apiKey == "" || apiSecret == "" {
		return nil, fmt.Errorf("livekit webhook credentials are required")
	}

	return &WebhookParser{provider: auth.NewSimpleKeyProvider(apiKey, apiSecret)}, nil
}

// ParseEgressEnded verifies the request signature and, when the event is
// egress_ended, returns its finalization payload. ok=false is a valid but
// non-egress_ended event (to ignore); a verification failure returns an error.
func (p *WebhookParser) ParseEgressEnded(r *http.Request) (application.FinalizeRecordingFromEgress, bool, error) {
	event, err := webhook.ReceiveWebhookEvent(r, p.provider)
	if err != nil {
		return application.FinalizeRecordingFromEgress{}, false, err
	}

	info := event.GetEgressInfo()
	if event.GetEvent() != "egress_ended" || info == nil {
		return application.FinalizeRecordingFromEgress{}, false, nil
	}

	finalize := application.FinalizeRecordingFromEgress{
		EgressID: info.GetEgressId(),
		Status:   info.GetStatus().String(),
	}
	for _, file := range info.GetFileResults() {
		if file.GetDuration() > 0 {
			milliseconds := int(file.GetDuration() / 1_000_000)
			finalize.DurationMs = &milliseconds
			break
		}
	}

	return finalize, true, nil
}
