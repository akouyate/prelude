package livekit

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

const joinTTL = 15 * time.Minute

type RealGateway struct {
	url          string
	apiKey       string
	apiSecret    string
	now          func() time.Time
	roomClient   *lksdk.RoomServiceClient
	egressClient *lksdk.EgressClient
	target       *EgressTarget
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

	serverURL := httpAPIURL(url)

	return &RealGateway{
		url:          url,
		apiKey:       apiKey,
		apiSecret:    apiSecret,
		now:          func() time.Time { return time.Now().UTC() },
		roomClient:   lksdk.NewRoomServiceClient(serverURL, apiKey, apiSecret),
		egressClient: lksdk.NewEgressClient(serverURL, apiKey, apiSecret),
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

// ConfigureEgress enables audio recording on the gateway by setting the R2
// destination. Until it is called, StartRoomCompositeEgress refuses to run.
func (g *RealGateway) ConfigureEgress(target EgressTarget) {
	g.target = &target
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

	canPublish := true
	canSubscribe := true
	canPublishData := true
	// The Agent grant is keyed off the "agent-" identity prefix, which is safe to
	// trust because the participant identity is assigned server-side by the
	// application service ("candidate-"+CandidateID for the candidate,
	// "agent-"+SessionID for the interviewer) and never taken from client input —
	// so a candidate can never present an "agent-" identity to obtain it.
	token, err := auth.NewAccessToken(g.apiKey, g.apiSecret).
		SetIdentity(participant).
		SetName(participant).
		SetValidFor(joinTTL).
		AddGrant(&auth.VideoGrant{
			RoomJoin:       true,
			Room:           roomName,
			CanPublish:     &canPublish,
			CanSubscribe:   &canSubscribe,
			CanPublishData: &canPublishData,
			Agent:          strings.HasPrefix(participant, "agent-"),
		}).
		ToJWT()
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

// EnsureRoom idempotently pre-provisions the room with controlled options before
// either participant is handed a join token. CreateRoom is idempotent server-side
// (an existing room returns the room), so a retry is safe.
func (g *RealGateway) EnsureRoom(ctx context.Context, input application.EnsureRoomInput) error {
	roomName := strings.TrimSpace(input.RoomName)
	if roomName == "" {
		return fmt.Errorf("livekit room name is required")
	}

	_, err := g.roomClient.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:            roomName,
		EmptyTimeout:    uint32(input.EmptyTimeout.Seconds()),
		MaxParticipants: input.MaxParticipants,
	})

	return err
}

// StartRoomCompositeEgress starts an audio-only room-composite egress that mixes
// every participant's audio into a single OGG/Opus file written straight to R2.
func (g *RealGateway) StartRoomCompositeEgress(ctx context.Context, input application.StartEgressInput) (application.EgressHandle, error) {
	if g.target == nil {
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

	info, err := g.egressClient.StartRoomCompositeEgress(ctx, &livekit.RoomCompositeEgressRequest{
		RoomName:  roomName,
		AudioOnly: true,
		FileOutputs: []*livekit.EncodedFileOutput{{
			FileType: livekit.EncodedFileType_OGG,
			Filepath: objectKey,
			Output: &livekit.EncodedFileOutput_S3{S3: &livekit.S3Upload{
				Bucket:         g.target.Bucket,
				Region:         g.target.Region,
				AccessKey:      g.target.AccessKey,
				Secret:         g.target.Secret,
				Endpoint:       g.target.Endpoint,
				ForcePathStyle: true,
			}},
		}},
	})
	if err != nil {
		return application.EgressHandle{}, err
	}
	if info.GetEgressId() == "" {
		return application.EgressHandle{}, fmt.Errorf("livekit egress response missing egress id")
	}

	return application.EgressHandle{EgressID: info.GetEgressId()}, nil
}

// StopEgress ends an in-flight egress so the recording finalizes promptly. It is
// best-effort at the call site; LiveKit also auto-stops on room close.
func (g *RealGateway) StopEgress(ctx context.Context, egressID string) error {
	egressID = strings.TrimSpace(egressID)
	if egressID == "" {
		return fmt.Errorf("livekit egress id is required")
	}

	_, err := g.egressClient.StopEgress(ctx, &livekit.StopEgressRequest{EgressId: egressID})

	return err
}

// GetEgress polls one egress job's current state (via ListEgress filtered by id).
// Reconciliation uses it to finalize recordings whose egress_ended webhook never
// arrived.
func (g *RealGateway) GetEgress(ctx context.Context, egressID string) (application.EgressState, error) {
	egressID = strings.TrimSpace(egressID)
	if egressID == "" {
		return application.EgressState{}, fmt.Errorf("livekit egress id is required")
	}

	response, err := g.egressClient.ListEgress(ctx, &livekit.ListEgressRequest{EgressId: egressID})
	if err != nil {
		return application.EgressState{}, err
	}
	if len(response.GetItems()) == 0 {
		return application.EgressState{}, fmt.Errorf("egress %s not found", egressID)
	}

	return egressStateFromInfo(response.GetItems()[0]), nil
}

// egressStateFromInfo normalizes a LiveKit EgressInfo: the status enum name and
// the recorded duration (LiveKit reports nanoseconds) converted to milliseconds.
func egressStateFromInfo(info *livekit.EgressInfo) application.EgressState {
	state := application.EgressState{Status: info.GetStatus().String()}
	for _, file := range info.GetFileResults() {
		if file.GetDuration() > 0 {
			milliseconds := int(file.GetDuration() / 1_000_000)
			state.DurationMs = &milliseconds
			break
		}
	}

	return state
}

// httpAPIURL converts a LiveKit client URL (wss://host / ws://host) to its HTTP
// server-API base (https://host / http://host) for the server SDK clients.
func httpAPIURL(rawURL string) string {
	switch {
	case strings.HasPrefix(rawURL, "wss://"):
		return "https://" + strings.TrimPrefix(rawURL, "wss://")
	case strings.HasPrefix(rawURL, "ws://"):
		return "http://" + strings.TrimPrefix(rawURL, "ws://")
	default:
		return rawURL
	}
}
