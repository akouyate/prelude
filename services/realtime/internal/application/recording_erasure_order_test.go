package application_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

/*
Ordering is the whole safety property of audio erasure, and the reason the
recording foreign key is now RESTRICT rather than CASCADE.

The database can only refuse an unsafe DELETE; it cannot make erasure itself
safe. That comes from one rule, enforced here: the R2 object is deleted BEFORE
the row is tombstoned, and `object_key` is cleared only once the object is
actually gone. Reverse the two and a failed tombstone-write is recoverable, but
a failed object-delete is not: the row would say "deleted" with no key left, and
the audio would sit in R2 with nothing pointing at it — precisely the orphan the
candidate privacy notice promises cannot exist.

The tests below assert the SEQUENCE, not just the end state, because the end
state is identical either way when nothing fails. They share one ordered log
between the object store and the recording repository so the interleaving is
observable.
*/

// erasureLog records object deletes and tombstone writes in one ordered slice,
// so a test can assert that one happened before the other rather than merely
// that both happened.
type erasureLog struct {
	calls []string
}

func (l *erasureLog) record(call string) { l.calls = append(l.calls, call) }

func (l *erasureLog) String() string { return strings.Join(l.calls, " -> ") }

// requireObjectDeletedBeforeTombstone asserts the log contains exactly one
// delete of objectKey and one tombstone of recordingID, in that order.
func (l *erasureLog) requireObjectDeletedBeforeTombstone(t *testing.T, objectKey, recordingID string) {
	t.Helper()

	deleteAt := l.indexOf("delete_object:" + objectKey)
	tombstoneAt := l.indexOf("tombstone:" + recordingID)
	if deleteAt < 0 {
		t.Fatalf("expected the audio object %q to be deleted, got %s", objectKey, l)
	}
	if tombstoneAt < 0 {
		t.Fatalf("expected recording %q to be tombstoned, got %s", recordingID, l)
	}
	if deleteAt > tombstoneAt {
		t.Fatalf("the R2 object must be deleted BEFORE the row is tombstoned, otherwise a failed delete leaves orphaned audio with object_key already cleared; got %s", l)
	}
}

func (l *erasureLog) indexOf(call string) int {
	for i, recorded := range l.calls {
		if recorded == call {
			return i
		}
	}
	return -1
}

func (l *erasureLog) count(prefix string) int {
	total := 0
	for _, recorded := range l.calls {
		if strings.HasPrefix(recorded, prefix) {
			total++
		}
	}
	return total
}

type auditingObjectStore struct {
	log *erasureLog
	err error
}

func (a *auditingObjectStore) DeleteObject(_ context.Context, key string) error {
	if a.err != nil {
		// A failed delete is NOT logged as a delete: nothing was removed.
		a.log.record("delete_object_failed:" + key)
		return a.err
	}
	a.log.record("delete_object:" + key)
	return nil
}

// auditingRecordingRepository wraps the real memory store so every method keeps
// its real behaviour and only the tombstone write is observed. Embedding means a
// method added to RecordingRepository tomorrow is inherited, not silently
// stubbed out into a no-op.
type auditingRecordingRepository struct {
	*store.MemoryStore
	log *erasureLog
}

func (a *auditingRecordingRepository) MarkRecordingDeleted(
	ctx context.Context,
	input application.MarkRecordingDeletedInput,
) error {
	a.log.record("tombstone:" + input.ID)
	return a.MemoryStore.MarkRecordingDeleted(ctx, input)
}

// newAuditedErasureService wires a service whose object store and recording
// repository write to the same ordered log.
func newAuditedErasureService(t *testing.T) (*application.Service, *auditingRecordingRepository, *erasureLog, fixedClock) {
	t.Helper()

	clock := fixedClock{now: time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)}
	log := &erasureLog{}
	repo := &auditingRecordingRepository{MemoryStore: store.NewMemoryStore(), log: log}
	service := application.NewService(repo.MemoryStore, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)
	service.SetObjectStore(&auditingObjectStore{log: log})

	return service, repo, log, clock
}

func seedRecordingInStatus(
	t *testing.T,
	repo *auditingRecordingRepository,
	id string,
	sessionID string,
	objectKey string,
	status domain.RecordingStatus,
	at time.Time,
) {
	t.Helper()

	recording := domain.Recording{
		ID:        id,
		SessionID: sessionID,
		EgressID:  "eg_" + id,
		ObjectKey: objectKey,
		Status:    status,
		Format:    "audio/ogg",
		StartedAt: at,
		CreatedAt: at,
		UpdatedAt: at,
	}
	if status != domain.RecordingStatusRecording {
		endedAt := at.Add(3 * time.Minute)
		recording.EndedAt = &endedAt
	}
	if status == domain.RecordingStatusFailed {
		recording.FailedReason = "egress_start_failed"
	}
	if err := repo.CreateRecording(context.Background(), recording); err != nil {
		t.Fatalf("seed %s recording %s: %v", status, id, err)
	}
	if status == domain.RecordingStatusDeleted {
		// Reach the tombstone through the real transition, so the row looks exactly
		// like one a previous erasure produced — then reset the log, since seeding
		// is not what the test is measuring.
		if err := repo.MarkRecordingDeleted(context.Background(), application.MarkRecordingDeletedInput{
			ID:        id,
			Reason:    "erasure_request",
			DeletedAt: at,
		}); err != nil {
			t.Fatalf("seed tombstone %s: %v", id, err)
		}
		repo.log.calls = nil
	}
}

// TestEraseRecordingsDeletesAvailableObjectBeforeTombstoning covers the ordinary
// case: a finished recording whose audio is really sitting in R2.
func TestEraseRecordingsDeletesAvailableObjectBeforeTombstoning(t *testing.T) {
	service, repo, log, clock := newAuditedErasureService(t)

	const sessionID = "is_order_available"
	seedRecordingInStatus(t, repo, "available_1", sessionID, "recordings/is_order_available/1.ogg",
		domain.RecordingStatusAvailable, clock.now.Add(-10*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("EraseRecordingsForSession returned error: %v", err)
	}
	if erased != 1 {
		t.Fatalf("expected 1 erased, got %d", erased)
	}

	log.requireObjectDeletedBeforeTombstone(t, "recordings/is_order_available/1.ogg", "available_1")

	rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_available_1")
	if rec.Status != domain.RecordingStatusDeleted {
		t.Fatalf("expected the row tombstoned, got %s", rec.Status)
	}
	if rec.ObjectKey != "" {
		t.Fatalf("object_key must be cleared only after the object is gone — and then it MUST be cleared, got %q", rec.ObjectKey)
	}
}

// TestEraseRecordingsDeletesFailedRecordingObjectBeforeTombstoning covers the
// state that is easiest to get wrong. A "failed" recording is not a recording
// that produced nothing: an egress can fail partway and leave a partial object
// under the key the row still carries. Erasure must therefore treat it like any
// other key — attempt the delete first, then tombstone — rather than assume
// there is nothing to delete and skip straight to the row.
func TestEraseRecordingsDeletesFailedRecordingObjectBeforeTombstoning(t *testing.T) {
	service, repo, log, clock := newAuditedErasureService(t)

	const sessionID = "is_order_failed"
	seedRecordingInStatus(t, repo, "failed_1", sessionID, "recordings/is_order_failed/1.ogg",
		domain.RecordingStatusFailed, clock.now.Add(-10*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("EraseRecordingsForSession returned error: %v", err)
	}
	if erased != 1 {
		t.Fatalf("a failed recording still owns a key that may hold partial audio; expected 1 erased, got %d", erased)
	}

	log.requireObjectDeletedBeforeTombstone(t, "recordings/is_order_failed/1.ogg", "failed_1")
}

// TestEraseRecordingsSkipsAlreadyDeletedRecordingEntirely pins idempotence at
// the call level, not just the outcome level: a re-run must not re-issue a
// delete for a key that is already gone (the row no longer carries one, so the
// call would be a delete of the empty key), and must not rewrite the tombstone —
// deleted_at records when the right was honoured, and a retry must not move it.
func TestEraseRecordingsSkipsAlreadyDeletedRecordingEntirely(t *testing.T) {
	service, repo, log, clock := newAuditedErasureService(t)

	const sessionID = "is_order_deleted"
	seedRecordingInStatus(t, repo, "deleted_1", sessionID, "recordings/is_order_deleted/1.ogg",
		domain.RecordingStatusDeleted, clock.now.Add(-10*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("EraseRecordingsForSession returned error: %v", err)
	}
	if erased != 0 {
		t.Fatalf("expected an already-erased recording to be skipped, got %d erased", erased)
	}
	if len(log.calls) != 0 {
		t.Fatalf("an already-erased recording must produce no object delete and no tombstone write, got %s", log)
	}
}

// TestEraseRecordingsNeverTombstonesInFlightRecording is the state the issue
// singles out. An in-flight row's object does not exist yet, so deleting now
// would no-op and the still-running egress would land its audio AFTER the
// tombstone cleared object_key — an orphan created by the erasure itself.
//
// The requirement is therefore: stop the egress, and keep the row (with its key)
// until finalization or a later erasure can complete. Never tombstone in flight.
func TestEraseRecordingsNeverTombstonesInFlightRecording(t *testing.T) {
	service, repo, log, clock := newAuditedErasureService(t)
	egress := &fakeEgress{}
	service.SetEgressGateway(egress)

	const sessionID = "is_order_inflight"
	seedRecordingInStatus(t, repo, "inflight_1", sessionID, "recordings/is_order_inflight/1.ogg",
		domain.RecordingStatusRecording, clock.now.Add(-1*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("EraseRecordingsForSession returned error: %v", err)
	}
	if erased != 0 {
		t.Fatalf("an in-flight recording cannot be counted as erased — its audio has not landed yet; got %d", erased)
	}

	if len(egress.stopped) != 1 || egress.stopped[0] != "eg_inflight_1" {
		t.Fatalf("expected the in-flight egress to be stopped so the object can finalize, got %v", egress.stopped)
	}
	if log.count("tombstone:") != 0 {
		t.Fatalf("an in-flight row must NEVER be tombstoned: the egress would then land audio with no key pointing at it; got %s", log)
	}

	rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_inflight_1")
	if rec.Status != domain.RecordingStatusRecording {
		t.Fatalf("the in-flight row must survive until finalization, got %s", rec.Status)
	}
	if rec.ObjectKey != "recordings/is_order_inflight/1.ogg" {
		t.Fatalf("the in-flight key is the only handle on the audio that is about to land; got %q", rec.ObjectKey)
	}
}

// TestEraseRecordingsKeepsKeyAndStatusWhenObjectDeleteFails is the retry
// contract. A failing R2 must leave the row exactly as it was — same status,
// same object_key — because those two fields are the entire input to the next
// attempt. Tombstoning here would lose the key and strand the object forever.
func TestEraseRecordingsKeepsKeyAndStatusWhenObjectDeleteFails(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)}
	log := &erasureLog{}
	repo := &auditingRecordingRepository{MemoryStore: store.NewMemoryStore(), log: log}
	service := application.NewService(repo.MemoryStore, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)
	service.SetObjectStore(&auditingObjectStore{log: log, err: errors.New("r2 unavailable")})

	const sessionID = "is_order_r2_down"
	seedRecordingInStatus(t, repo, "retry_1", sessionID, "recordings/is_order_r2_down/1.ogg",
		domain.RecordingStatusAvailable, clock.now.Add(-10*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err == nil {
		t.Fatal("a failed object delete must surface, so the caller knows the audio is still there and retries")
	}
	if erased != 0 {
		t.Fatalf("expected 0 erased when R2 refuses, got %d", erased)
	}
	if log.count("tombstone:") != 0 {
		t.Fatalf("nothing may be tombstoned while its object still exists, got %s", log)
	}

	rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_retry_1")
	if rec.Status != domain.RecordingStatusAvailable {
		t.Fatalf("the row must stay available so the retry still selects it, got %s", rec.Status)
	}
	if rec.ObjectKey != "recordings/is_order_r2_down/1.ogg" {
		t.Fatalf("the retry finds the object by this key; it must be intact, got %q", rec.ObjectKey)
	}

	// And the retry, once R2 recovers, completes in the correct order.
	service.SetObjectStore(&auditingObjectStore{log: log})
	if _, err := service.EraseRecordingsForSession(context.Background(), sessionID); err != nil {
		t.Fatalf("the retry returned error: %v", err)
	}
	log.requireObjectDeletedBeforeTombstone(t, "recordings/is_order_r2_down/1.ogg", "retry_1")
}
