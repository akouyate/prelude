package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

func TestPostgresStorePersistsEventsAcrossRepositoryInstances(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	firstStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}

	session := domain.Session{
		ID:                "it_session_" + time.Now().UTC().Format("20060102150405.000000000"),
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "prelude-it-room",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC),
	}
	if err := firstStore.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	event := domain.Event{
		ID:               "it_evt_started_" + session.ID,
		SessionID:        session.ID,
		Type:             domain.EventSessionStarted,
		Actor:            domain.EventActorAgent,
		Sequence:         1,
		IdempotencyKey:   session.ID + ":session_started",
		OccurredAt:       time.Date(2026, 6, 17, 10, 0, 1, 0, time.UTC),
		Payload:          json.RawMessage(`{"provider":"mock"}`),
		ProviderMetadata: json.RawMessage(`{"provider_event_id":"provider_evt_1"}`),
	}
	result, err := firstStore.AppendEvent(ctx, event)
	if err != nil {
		t.Fatalf("AppendEvent returned error: %v", err)
	}
	if result.Event.CandidateID != session.CandidateID {
		t.Fatalf("expected candidate id %s, got %s", session.CandidateID, result.Event.CandidateID)
	}

	duplicate, err := firstStore.AppendEvent(ctx, event)
	if err != nil {
		t.Fatalf("duplicate AppendEvent returned error: %v", err)
	}
	if !duplicate.Duplicate {
		t.Fatal("expected duplicate event to be idempotent")
	}

	if err := firstStore.Close(); err != nil {
		t.Fatalf("failed to close first store: %v", err)
	}

	secondStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("second NewPostgresStore returned error: %v", err)
	}
	defer secondStore.Close()

	persisted, err := secondStore.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if persisted.Status != domain.SessionStatusInProgress {
		t.Fatalf("expected in_progress status, got %s", persisted.Status)
	}
	if len(persisted.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(persisted.Events))
	}
	if string(persisted.Events[0].ProviderMetadata) != `{"provider_event_id": "provider_evt_1"}` &&
		string(persisted.Events[0].ProviderMetadata) != `{"provider_event_id":"provider_evt_1"}` {
		t.Fatalf("expected provider metadata roundtrip, got %s", persisted.Events[0].ProviderMetadata)
	}
}

func TestPostgresStoreRejectsOutOfOrderEvents(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	postgresStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}
	defer postgresStore.Close()

	session := domain.Session{
		ID:                "it_order_" + time.Now().UTC().Format("20060102150405.000000000"),
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "prelude-it-room",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC),
	}
	if err := postgresStore.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	_, err = postgresStore.AppendEvent(ctx, domain.Event{
		ID:             "it_evt_out_of_order_" + session.ID,
		SessionID:      session.ID,
		Type:           domain.EventSessionStarted,
		Actor:          domain.EventActorAgent,
		Sequence:       2,
		IdempotencyKey: session.ID + ":session_started",
		OccurredAt:     time.Date(2026, 6, 17, 10, 0, 1, 0, time.UTC),
		Payload:        json.RawMessage(`{"provider":"mock"}`),
	})
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
	}
}
