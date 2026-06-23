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

func TestMemoryStoreStaleRecordings(t *testing.T) {
	ctx := context.Background()
	s := store.NewMemoryStore()
	base := time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)

	mk := func(id string, egressID string, status domain.RecordingStatus, startedAt time.Time) {
		if err := s.CreateRecording(ctx, domain.Recording{
			ID:        id,
			SessionID: "is_" + id,
			EgressID:  egressID,
			ObjectKey: "recordings/" + id + "/1.ogg",
			Status:    status,
			Format:    "audio/ogg",
			StartedAt: startedAt,
			CreatedAt: startedAt,
			UpdatedAt: startedAt,
		}); err != nil {
			t.Fatalf("CreateRecording %s: %v", id, err)
		}
	}
	mk("old", "eg_old", domain.RecordingStatusRecording, base.Add(-time.Hour))
	mk("fresh", "eg_fresh", domain.RecordingStatusRecording, base.Add(-time.Minute))
	mk("done", "eg_done", domain.RecordingStatusAvailable, base.Add(-time.Hour))

	stale, err := s.StaleRecordings(ctx, base.Add(-10*time.Minute), 50)
	if err != nil {
		t.Fatalf("StaleRecordings returned error: %v", err)
	}
	if len(stale) != 1 || stale[0].EgressID != "eg_old" {
		t.Fatalf("expected only eg_old stale (old + still recording), got %+v", stale)
	}
}

func TestPostgresStoreStaleRecordings(t *testing.T) {
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
		ID:                "it_stale_" + suffix,
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "prelude-it-stale",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         time.Now().UTC(),
		UpdatedAt:         time.Now().UTC(),
	}
	if err := pg.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	startedLongAgo := time.Now().UTC().Add(-time.Hour).Truncate(time.Millisecond)
	egressID := "eg_stale_" + suffix
	if err := pg.CreateRecording(ctx, domain.Recording{
		ID:        "rec_stale_" + suffix,
		SessionID: session.ID,
		EgressID:  egressID,
		ObjectKey: "recordings/" + session.ID + "/1.ogg",
		Status:    domain.RecordingStatusRecording,
		Format:    "audio/ogg",
		StartedAt: startedLongAgo,
		CreatedAt: startedLongAgo,
		UpdatedAt: startedLongAgo,
	}); err != nil {
		t.Fatalf("CreateRecording returned error: %v", err)
	}

	stale, err := pg.StaleRecordings(ctx, time.Now().UTC().Add(-10*time.Minute), 50)
	if err != nil {
		t.Fatalf("StaleRecordings returned error: %v", err)
	}
	found := false
	for _, recording := range stale {
		if recording.EgressID == egressID {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected %s in the stale set", egressID)
	}

	// Leave no in-flight smoke row behind.
	if _, err := pg.FinalizeRecordingByEgressID(ctx, application.FinalizeRecordingInput{
		EgressID:  egressID,
		Status:    domain.RecordingStatusFailed,
		EndedAt:   time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}); err != nil {
		t.Fatalf("cleanup finalize returned error: %v", err)
	}
}
