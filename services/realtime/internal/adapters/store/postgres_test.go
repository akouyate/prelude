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

func TestPostgresStorePurgesOnlyExpiredPreviewSessions(t *testing.T) {
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

	now := time.Now().UTC()
	suffix := now.Format("20060102150405.000000000")
	expiredAt := now.Add(-time.Minute)
	activeUntil := now.Add(time.Hour)
	expired := domain.Session{
		ID:                "it_preview_expired_" + suffix,
		InterviewPlanID:   "pv_expired",
		CandidateID:       "preview_expired",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "hirecall-it-preview-expired",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		Kind:              domain.SessionKindPreview,
		ExpiresAt:         &expiredAt,
		CreatedAt:         now.Add(-time.Hour),
		UpdatedAt:         now.Add(-time.Hour),
	}
	active := expired
	active.ID = "it_preview_active_" + suffix
	active.InterviewPlanID = "pv_active"
	active.CandidateID = "preview_active"
	active.LiveKitRoomName = "hirecall-it-preview-active"
	active.ExpiresAt = &activeUntil

	if err := postgresStore.CreateSession(ctx, expired); err != nil {
		t.Fatalf("CreateSession(expired) returned error: %v", err)
	}
	if err := postgresStore.CreateSession(ctx, active); err != nil {
		t.Fatalf("CreateSession(active) returned error: %v", err)
	}

	deleted, err := postgresStore.PurgeExpiredCandidatePreviewData(ctx, now)
	if err != nil {
		t.Fatalf("PurgeExpiredCandidatePreviewData returned error: %v", err)
	}
	if deleted < 1 {
		t.Fatalf("expected at least one deleted row, got %d", deleted)
	}
	if _, err := postgresStore.GetSession(ctx, expired.ID); !errors.Is(err, application.ErrSessionNotFound) {
		t.Fatalf("expected expired preview to be deleted, got %v", err)
	}
	if _, err := postgresStore.GetSession(ctx, active.ID); err != nil {
		t.Fatalf("expected active preview to remain, got %v", err)
	}
}

// TestPostgresStoreDeleteEventsForSessionKeepsTheSessionRow pins the physical
// meaning of "erasing the transcript" against a real Postgres: the event rows go,
// the session row stays as the content-free tombstone, and a re-run is a no-op.
func TestPostgresStoreDeleteEventsForSessionKeepsTheSessionRow(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	postgresStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}

	session := domain.Session{
		ID:                "it_erase_" + time.Now().UTC().Format("20060102150405.000000000"),
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "prelude-erase-room",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC),
		UpdatedAt:         time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC),
	}
	if err := postgresStore.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	if _, err := postgresStore.AppendEvent(ctx, domain.Event{
		ID:             "it_erase_evt_" + session.ID,
		SessionID:      session.ID,
		Type:           domain.EventSessionStarted,
		Actor:          domain.EventActorAgent,
		Sequence:       1,
		IdempotencyKey: session.ID + ":session_started",
		OccurredAt:     time.Date(2026, 6, 17, 10, 0, 1, 0, time.UTC),
		Payload:        json.RawMessage(`{"provider":"mock"}`),
	}); err != nil {
		t.Fatalf("AppendEvent returned error: %v", err)
	}

	deleted, err := postgresStore.DeleteEventsForSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("DeleteEventsForSession returned error: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("expected 1 event deleted, got %d", deleted)
	}

	stored, err := postgresStore.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("expected the session row to survive erasure, got error: %v", err)
	}
	if len(stored.Events) != 0 {
		t.Fatalf("expected no events after erasure, got %d", len(stored.Events))
	}
	if stored.ID != session.ID || stored.Status != session.Status {
		t.Fatalf("erasure must preserve id and status, got %+v", stored)
	}

	again, err := postgresStore.DeleteEventsForSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("idempotent DeleteEventsForSession returned error: %v", err)
	}
	if again != 0 {
		t.Fatalf("expected a re-run to delete nothing, got %d", again)
	}
}
