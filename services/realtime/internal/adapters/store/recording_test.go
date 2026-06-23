package store_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

var (
	_ application.RecordingRepository = (*store.MemoryStore)(nil)
	_ application.RecordingRepository = (*store.PostgresStore)(nil)
)

func intPtr(v int) *int { return &v }

func TestMemoryStoreRecordingLifecycle(t *testing.T) {
	ctx := context.Background()
	s := store.NewMemoryStore()

	startedAt := time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)
	rec := domain.Recording{
		ID:        "rec_1",
		SessionID: "is_1",
		EgressID:  "eg_1",
		ObjectKey: "recordings/org_1/is_1/1.ogg",
		Status:    domain.RecordingStatusRecording,
		Format:    "audio/ogg",
		StartedAt: startedAt,
		CreatedAt: startedAt,
		UpdatedAt: startedAt,
	}
	if err := s.CreateRecording(ctx, rec); err != nil {
		t.Fatalf("CreateRecording returned error: %v", err)
	}

	active, found, err := s.ActiveRecordingForSession(ctx, "is_1")
	if err != nil {
		t.Fatalf("ActiveRecordingForSession returned error: %v", err)
	}
	if !found {
		t.Fatal("expected an active recording")
	}
	if active.EgressID != "eg_1" || active.Status != domain.RecordingStatusRecording {
		t.Fatalf("unexpected active recording: %+v", active)
	}

	endedAt := startedAt.Add(3 * time.Minute)
	updated, err := s.FinalizeRecordingByEgressID(ctx, application.FinalizeRecordingInput{
		EgressID:   "eg_1",
		Status:     domain.RecordingStatusAvailable,
		DurationMs: intPtr(180000),
		EndedAt:    endedAt,
		UpdatedAt:  endedAt,
	})
	if err != nil {
		t.Fatalf("FinalizeRecordingByEgressID returned error: %v", err)
	}
	if !updated {
		t.Fatal("expected the in-flight recording to be finalized")
	}

	if _, found, err = s.ActiveRecordingForSession(ctx, "is_1"); err != nil || found {
		t.Fatalf("expected no active recording after finalize (found=%v err=%v)", found, err)
	}

	// Redelivered webhook: finalizing the same egress again must be a no-op.
	updated, err = s.FinalizeRecordingByEgressID(ctx, application.FinalizeRecordingInput{
		EgressID:  "eg_1",
		Status:    domain.RecordingStatusAvailable,
		EndedAt:   endedAt,
		UpdatedAt: endedAt,
	})
	if err != nil {
		t.Fatalf("idempotent finalize returned error: %v", err)
	}
	if updated {
		t.Fatal("expected redelivered finalize to be a no-op")
	}

	// Reconnect: a second egress for the same session is legitimate (1:N), and it
	// becomes the new active recording.
	rec2 := rec
	rec2.ID = "rec_2"
	rec2.EgressID = "eg_2"
	rec2.StartedAt = endedAt.Add(time.Minute)
	if err := s.CreateRecording(ctx, rec2); err != nil {
		t.Fatalf("second CreateRecording returned error: %v", err)
	}
	active, found, err = s.ActiveRecordingForSession(ctx, "is_1")
	if err != nil || !found {
		t.Fatalf("expected the second recording active (found=%v err=%v)", found, err)
	}
	if active.EgressID != "eg_2" {
		t.Fatalf("expected eg_2 active, got %s", active.EgressID)
	}
}

func TestPostgresStoreRecordingLifecycle(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	pg, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}
	defer pg.Close()

	suffix := time.Now().UTC().Format("20060102150405.000000000")
	session := domain.Session{
		ID:                "it_rec_session_" + suffix,
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "prelude-it-rec",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}
	if err := pg.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	startedAt := time.Now().UTC().Truncate(time.Millisecond)
	egressID := "eg_" + suffix
	if err := pg.CreateRecording(ctx, domain.Recording{
		ID:        "rec_" + suffix,
		SessionID: session.ID,
		EgressID:  egressID,
		ObjectKey: "recordings/org/" + session.ID + "/1.ogg",
		Status:    domain.RecordingStatusRecording,
		Format:    "audio/ogg",
		StartedAt: startedAt,
		CreatedAt: startedAt,
		UpdatedAt: startedAt,
	}); err != nil {
		t.Fatalf("CreateRecording returned error: %v", err)
	}

	active, found, err := pg.ActiveRecordingForSession(ctx, session.ID)
	if err != nil || !found {
		t.Fatalf("expected active recording (found=%v err=%v)", found, err)
	}
	if active.EgressID != egressID {
		t.Fatalf("expected egress %s, got %s", egressID, active.EgressID)
	}

	endedAt := startedAt.Add(2 * time.Minute)
	updated, err := pg.FinalizeRecordingByEgressID(ctx, application.FinalizeRecordingInput{
		EgressID:   egressID,
		Status:     domain.RecordingStatusAvailable,
		DurationMs: intPtr(120000),
		EndedAt:    endedAt,
		UpdatedAt:  endedAt,
	})
	if err != nil || !updated {
		t.Fatalf("expected finalize to update (updated=%v err=%v)", updated, err)
	}

	persisted, found, err := pg.ActiveRecordingForSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("ActiveRecordingForSession returned error: %v", err)
	}
	if found {
		t.Fatalf("expected no active recording after finalize, got %+v", persisted)
	}

	updated, err = pg.FinalizeRecordingByEgressID(ctx, application.FinalizeRecordingInput{
		EgressID:  egressID,
		Status:    domain.RecordingStatusAvailable,
		EndedAt:   endedAt,
		UpdatedAt: endedAt,
	})
	if err != nil {
		t.Fatalf("idempotent finalize returned error: %v", err)
	}
	if updated {
		t.Fatal("expected redelivered finalize to be a no-op")
	}
}
