package livekit

import (
	"context"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/application"
)

type MockGateway struct {
	URL string
}

func NewMockGateway(url string) *MockGateway {
	if url == "" {
		url = "wss://mock-livekit.prelude.local"
	}

	return &MockGateway{URL: url}
}

func (g *MockGateway) CreateJoin(_ context.Context, input application.LiveKitJoinInput) (application.LiveKitJoin, error) {
	return application.LiveKitJoin{
		RoomName:    input.RoomName,
		URL:         g.URL,
		Token:       "mock_lk_" + input.SessionID + "_" + input.Participant,
		Participant: input.Participant,
		ExpiresAt:   time.Now().UTC().Add(15 * time.Minute),
	}, nil
}
