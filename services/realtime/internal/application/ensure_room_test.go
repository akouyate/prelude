package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
)

// recordingLiveKit records the order of gateway calls so we can assert the room
// is ensured BEFORE either participant is handed a join token.
type recordingLiveKit struct {
	calls     []string
	ensureErr error
}

func (r *recordingLiveKit) EnsureRoom(_ context.Context, input application.EnsureRoomInput) error {
	r.calls = append(r.calls, "ensure:"+input.RoomName)
	return r.ensureErr
}

func (r *recordingLiveKit) CreateJoin(_ context.Context, input application.LiveKitJoinInput) (application.LiveKitJoin, error) {
	r.calls = append(r.calls, "join:"+input.Participant)
	return application.LiveKitJoin{
		RoomName:    input.RoomName,
		URL:         "wss://livekit.example.test",
		Token:       "tok_" + input.Participant,
		Participant: input.Participant,
		ExpiresAt:   time.Date(2026, 6, 17, 10, 15, 0, 0, time.UTC),
	}, nil
}

func TestServiceCreateSessionEnsuresRoomBeforeJoin(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	gateway := &recordingLiveKit{}
	service := application.NewService(store.NewMemoryStore(), gateway, clock)

	output, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	want := []string{
		"ensure:" + output.Session.LiveKitRoomName,
		"join:candidate-candidate_123",
	}
	if len(gateway.calls) != len(want) || gateway.calls[0] != want[0] || gateway.calls[1] != want[1] {
		t.Fatalf("expected room ensured before join %v, got %v", want, gateway.calls)
	}
}

func TestServiceCreateSessionSucceedsWhenEnsureRoomFails(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	gateway := &recordingLiveKit{ensureErr: errors.New("livekit unavailable")}
	service := application.NewService(store.NewMemoryStore(), gateway, clock)

	// EnsureRoom is best-effort: a LiveKit blip must not stop the candidate from
	// getting a token (LiveKit auto-creates the room on join as a fallback).
	output, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("expected best-effort (non-fatal) room ensure, got error: %v", err)
	}
	if output.Join.Token == "" {
		t.Fatal("expected a join token even when EnsureRoom fails")
	}
}
