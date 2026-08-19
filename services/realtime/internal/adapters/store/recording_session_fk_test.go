package store_test

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
	"github.com/jackc/pgx/v5/pgconn"
)

// The constraint that carries the invariant. Named explicitly because the whole
// point of this suite is that THIS constraint, by THIS name, is what refuses the
// delete — a rename or a Prisma regeneration that silently drops it must fail a
// test rather than quietly restore the orphan-audio hole.
const recordingSessionFKName = "live_interview_recordings_session_id_fkey"

// openRawPostgres opens a second connection alongside the store, because there
// is deliberately NO application code path that deletes a session row (issue
// #100 decision 3: no generic session or organization hard-delete endpoint). The
// only way to attempt the delete these tests must prove impossible is raw SQL —
// which is also exactly how it would happen in production: a console, a psql
// prompt, a migration, an ops script.
func openRawPostgres(t *testing.T, databaseURL string) *sql.DB {
	t.Helper()

	// Mirrors the store's own normalization: Prisma's `?schema=` is not a libpq
	// parameter, and local Postgres runs without TLS.
	normalized := databaseURL
	if parsed, err := url.Parse(databaseURL); err == nil {
		query := parsed.Query()
		query.Del("schema")
		if query.Get("sslmode") == "" {
			query.Set("sslmode", "disable")
		}
		parsed.RawQuery = query.Encode()
		normalized = parsed.String()
	}

	db, err := sql.Open("pgx", normalized)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	return db
}

// seedSessionWithRecording creates one real session and one real recording row
// in the given status, and registers the cleanup that removes them in FK order
// (recordings first — which is the documented hard-delete order this ticket
// exists to enforce).
func seedSessionWithRecording(
	t *testing.T,
	ctx context.Context,
	postgresStore *store.PostgresStore,
	db *sql.DB,
	idSuffix string,
	status domain.RecordingStatus,
	objectKey string,
) string {
	t.Helper()

	now := time.Now().UTC()
	sessionID := "it_fk_session_" + idSuffix + "_" + now.Format("20060102150405.000000000")
	recordingID := "it_fk_rec_" + idSuffix + "_" + now.Format("20060102150405.000000000")

	session := domain.Session{
		ID:                sessionID,
		InterviewPlanID:   "plan_fk",
		CandidateID:       "candidate_fk",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "hirecall-it-fk-" + idSuffix,
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := postgresStore.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	endedAt := now
	recording := domain.Recording{
		ID:        recordingID,
		SessionID: sessionID,
		EgressID:  "eg_" + recordingID,
		ObjectKey: objectKey,
		Status:    status,
		Format:    "audio/ogg",
		StartedAt: now.Add(-3 * time.Minute),
		EndedAt:   &endedAt,
		CreatedAt: now.Add(-3 * time.Minute),
		UpdatedAt: now,
	}
	if err := postgresStore.CreateRecording(ctx, recording); err != nil {
		t.Fatalf("CreateRecording returned error: %v", err)
	}

	t.Cleanup(func() {
		// Recordings first, then the session: the exact order a deliberate
		// hard-delete must follow now that the FK restricts.
		_, _ = db.ExecContext(context.Background(),
			`delete from live_interview_recordings where session_id = $1`, sessionID)
		_, _ = db.ExecContext(context.Background(),
			`delete from live_interview_sessions where id = $1`, sessionID)
	})

	return sessionID
}

// assertForeignKeyViolation fails unless err is the Postgres foreign-key
// violation raised by the recording constraint. It asserts the SQLSTATE and the
// constraint name rather than a message substring, so the test still means
// something when Postgres rewords its errors.
func assertForeignKeyViolation(t *testing.T, err error) {
	t.Helper()

	if err == nil {
		t.Fatal("deleting a session that still has recording rows must be REFUSED by the database — it succeeded, which means the audio object in R2 is now orphaned with no row left to find it by")
	}

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected a Postgres error, got %T: %v", err, err)
	}
	if pgErr.Code != "23503" {
		t.Fatalf("expected SQLSTATE 23503 (foreign_key_violation), got %s: %v", pgErr.Code, pgErr.Message)
	}
	if pgErr.ConstraintName != recordingSessionFKName {
		t.Fatalf("expected constraint %s to refuse the delete, got %q", recordingSessionFKName, pgErr.ConstraintName)
	}
}

// TestDeletingASessionIsRefusedWhileARecordingReferencesIt is the invariant this
// ticket exists for. Before the fix the FK cascaded: deleting the session took
// the recording row with it and left the R2 object behind — audio the candidate
// privacy notice promises is "permanently deleted", with no row left pointing at
// it. The database must now refuse instead.
func TestDeletingASessionIsRefusedWhileARecordingReferencesIt(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	postgresStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}
	t.Cleanup(func() { _ = postgresStore.Close() })

	db := openRawPostgres(t, databaseURL)
	sessionID := seedSessionWithRecording(
		t, ctx, postgresStore, db, "available",
		domain.RecordingStatusAvailable, "recordings/it_fk/available.ogg",
	)

	_, err = db.ExecContext(ctx, `delete from live_interview_sessions where id = $1`, sessionID)
	assertForeignKeyViolation(t, err)

	// The refusal has to be total: a partially applied delete would be worse than
	// no protection at all.
	if _, err := postgresStore.GetSession(ctx, sessionID); err != nil {
		t.Fatalf("the refused delete must leave the session row intact, got %v", err)
	}
	recordings, err := postgresStore.RecordingsForSession(ctx, sessionID)
	if err != nil {
		t.Fatalf("RecordingsForSession returned error: %v", err)
	}
	if len(recordings) != 1 {
		t.Fatalf("expected the recording row to survive the refused delete, got %d", len(recordings))
	}
	if recordings[0].ObjectKey != "recordings/it_fk/available.ogg" {
		t.Fatalf("the object key is the only way back to the R2 object; it must survive, got %q", recordings[0].ObjectKey)
	}
}

// TestDeletingASessionIsRefusedWhileOnlyATombstoneReferencesIt is the subtle
// half. Erasure does not remove recording rows — it clears object_key and marks
// them "deleted", keeping the row as the audit trace that audio existed and was
// erased (ErasePersonalDataForSession depends on exactly this). So running
// erasure does NOT unlock the session delete, and must not: a deliberate
// hard-delete has to remove the tombstones explicitly, having first verified
// they are tombstones.
func TestDeletingASessionIsRefusedWhileOnlyATombstoneReferencesIt(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	postgresStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}
	t.Cleanup(func() { _ = postgresStore.Close() })

	db := openRawPostgres(t, databaseURL)
	// An erased recording: object gone, key cleared, row kept.
	sessionID := seedSessionWithRecording(
		t, ctx, postgresStore, db, "tombstone",
		domain.RecordingStatusDeleted, "",
	)

	_, err = db.ExecContext(ctx, `delete from live_interview_sessions where id = $1`, sessionID)
	assertForeignKeyViolation(t, err)
}

// TestDeletingASessionStillCascadesItsEvents keeps the change honest about its
// scope. Only the RECORDING edge becomes restrictive; the event edge stays
// cascading, because events carry no object-storage counterpart — deleting them
// with their session orphans nothing.
func TestDeletingASessionStillCascadesItsEvents(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	postgresStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}
	t.Cleanup(func() { _ = postgresStore.Close() })

	db := openRawPostgres(t, databaseURL)

	now := time.Now().UTC()
	sessionID := "it_fk_events_" + now.Format("20060102150405.000000000")
	if err := postgresStore.CreateSession(ctx, domain.Session{
		ID:                sessionID,
		InterviewPlanID:   "plan_fk_events",
		CandidateID:       "candidate_fk_events",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "hirecall-it-fk-events",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		CreatedAt:         now,
		UpdatedAt:         now,
	}); err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`delete from live_interview_sessions where id = $1`, sessionID)
	})

	if _, err := postgresStore.AppendEvent(ctx, domain.Event{
		ID:               "it_fk_evt_" + sessionID,
		SessionID:        sessionID,
		Type:             domain.EventSessionStarted,
		Actor:            domain.EventActorAgent,
		Sequence:         1,
		IdempotencyKey:   sessionID + ":session_started",
		OccurredAt:       now,
		Payload:          []byte(`{"provider":"mock"}`),
		ProviderMetadata: []byte(`{}`),
	}); err != nil {
		t.Fatalf("AppendEvent returned error: %v", err)
	}

	if _, err := db.ExecContext(ctx, `delete from live_interview_sessions where id = $1`, sessionID); err != nil {
		t.Fatalf("a session carrying only events must still be deletable, got %v", err)
	}

	var remaining int
	if err := db.QueryRowContext(ctx,
		`select count(*) from live_interview_events where session_id = $1`, sessionID,
	).Scan(&remaining); err != nil {
		t.Fatalf("counting events returned error: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("expected the events to cascade away with the session, got %d", remaining)
	}
}

// TestPurgeExpiredPreviewsSurvivesASessionThatStillHoldsRecordings is the
// non-regression the RESTRICT change puts at risk.
//
// The preview sweep deletes expired preview sessions outright. Preview sessions
// are never recorded (startRecordingIfNeeded returns early on SessionKindPreview),
// so in principle none of them can hold a recording row — but "in principle" is
// exactly what a fail-closed constraint must not depend on. If one ever did, the
// old code's single DELETE would raise 23503 and roll back the whole transaction,
// taking the CandidateExperiencePreview cleanup with it: one impossible row would
// wedge the sweep permanently, for every workspace.
//
// So the sweep must step around such a session rather than choke on it, and still
// purge everything else in the same pass.
func TestPurgeExpiredPreviewsSurvivesASessionThatStillHoldsRecordings(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required for Postgres store integration test")
	}

	ctx := context.Background()
	postgresStore, err := store.NewPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("NewPostgresStore returned error: %v", err)
	}
	t.Cleanup(func() { _ = postgresStore.Close() })

	db := openRawPostgres(t, databaseURL)

	now := time.Now().UTC()
	suffix := now.Format("20060102150405.000000000")
	expiredAt := now.Add(-time.Minute)

	// The impossible-but-guarded case: an expired preview that somehow owns audio.
	blocked := domain.Session{
		ID:                "it_preview_blocked_" + suffix,
		InterviewPlanID:   "pv_blocked_" + suffix,
		CandidateID:       "preview_blocked",
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   "hirecall-it-preview-blocked",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
		Kind:              domain.SessionKindPreview,
		ExpiresAt:         &expiredAt,
		CreatedAt:         now.Add(-time.Hour),
		UpdatedAt:         now.Add(-time.Hour),
	}
	// An ordinary expired preview that must still be swept in the same pass.
	ordinary := blocked
	ordinary.ID = "it_preview_ordinary_" + suffix
	ordinary.InterviewPlanID = "pv_ordinary_" + suffix
	ordinary.CandidateID = "preview_ordinary"
	ordinary.LiveKitRoomName = "hirecall-it-preview-ordinary"

	for _, session := range []domain.Session{blocked, ordinary} {
		if err := postgresStore.CreateSession(ctx, session); err != nil {
			t.Fatalf("CreateSession(%s) returned error: %v", session.ID, err)
		}
	}
	endedAt := now
	if err := postgresStore.CreateRecording(ctx, domain.Recording{
		ID:        "it_preview_rec_" + suffix,
		SessionID: blocked.ID,
		EgressID:  "eg_it_preview_rec_" + suffix,
		ObjectKey: "recordings/" + blocked.ID + "/1.ogg",
		Status:    domain.RecordingStatusAvailable,
		Format:    "audio/ogg",
		StartedAt: now.Add(-3 * time.Minute),
		EndedAt:   &endedAt,
		CreatedAt: now.Add(-3 * time.Minute),
		UpdatedAt: now,
	}); err != nil {
		t.Fatalf("CreateRecording returned error: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(),
			`delete from live_interview_recordings where session_id = $1`, blocked.ID)
		_, _ = db.ExecContext(context.Background(),
			`delete from live_interview_sessions where id in ($1, $2)`, blocked.ID, ordinary.ID)
	})

	if _, err := postgresStore.PurgeExpiredCandidatePreviewData(ctx, now); err != nil {
		t.Fatalf("one preview holding a recording must not wedge the whole sweep, got %v", err)
	}

	// The ordinary preview is gone...
	if _, err := postgresStore.GetSession(ctx, ordinary.ID); !errors.Is(err, application.ErrSessionNotFound) {
		t.Fatalf("expected the ordinary expired preview to be purged, got %v", err)
	}
	// ...and the one holding audio is deliberately left standing, with its row and
	// its key intact, so the audio remains reachable and erasable.
	if _, err := postgresStore.GetSession(ctx, blocked.ID); err != nil {
		t.Fatalf("expected the recording-holding preview to be kept, got %v", err)
	}
	recordings, err := postgresStore.RecordingsForSession(ctx, blocked.ID)
	if err != nil {
		t.Fatalf("RecordingsForSession returned error: %v", err)
	}
	if len(recordings) != 1 || recordings[0].ObjectKey == "" {
		t.Fatalf("the recording and its object key must survive the sweep, got %+v", recordings)
	}
}
