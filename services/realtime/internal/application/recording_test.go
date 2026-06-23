package application_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

type fakeEgress struct {
	started  []application.StartEgressInput
	stopped  []string
	attempts int
	err      error
	stopErr  error
	getState map[string]application.EgressState
	getErr   error
}

func (f *fakeEgress) GetEgress(_ context.Context, egressID string) (application.EgressState, error) {
	if f.getErr != nil {
		return application.EgressState{}, f.getErr
	}
	state, ok := f.getState[egressID]
	if !ok {
		return application.EgressState{}, fmt.Errorf("egress %s not found", egressID)
	}

	return state, nil
}

func (f *fakeEgress) StartRoomCompositeEgress(_ context.Context, input application.StartEgressInput) (application.EgressHandle, error) {
	f.attempts++
	if f.err != nil {
		return application.EgressHandle{}, f.err
	}
	f.started = append(f.started, input)
	return application.EgressHandle{EgressID: fmt.Sprintf("eg_test_%d", f.attempts)}, nil
}

func (f *fakeEgress) StopEgress(_ context.Context, egressID string) error {
	f.stopped = append(f.stopped, egressID)
	return f.stopErr
}

func newRecordingService(t *testing.T, consent bool) (*application.Service, *store.MemoryStore, *fakeEgress, application.CreateSessionOutput) {
	t.Helper()
	clock := fixedClock{now: time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	egress := &fakeEgress{}
	service.SetEgressGateway(egress)
	service.SetRecordingRepository(repo)
	service.SetRecordingConsentGate(repo)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		AllowedModalities: []domain.Modality{domain.ModalityAudio, domain.ModalityVideo},
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	if consent {
		repo.SetRecordingConsent(session.Session.ID, application.RecordingConsent{
			Granted:     true,
			CopyVersion: "candidate-consent-v2",
		})
	}

	return service, repo, egress, session
}

func ingestJoined(t *testing.T, service *application.Service, sessionID string, sequence int, eventID string) {
	t.Helper()
	joined := eventInput(sessionID, sequence, eventID, domain.EventCandidateJoined)
	joined.Actor = domain.EventActorCandidate
	joined.Payload = json.RawMessage(`{"candidate_participant_id":"candidate-session","modes":["audio","video"]}`)
	if _, err := service.IngestEvent(context.Background(), joined); err != nil {
		t.Fatalf("candidate_joined returned error: %v", err)
	}
}

func ingestAgentJoined(t *testing.T, service *application.Service, sessionID string, sequence int, eventID string) {
	t.Helper()
	agentJoined := eventInput(sessionID, sequence, eventID, domain.EventAgentJoined)
	if _, err := service.IngestEvent(context.Background(), agentJoined); err != nil {
		t.Fatalf("agent_joined returned error: %v", err)
	}
}

func ingestMediaReady(t *testing.T, service *application.Service, sessionID string, sequence int, eventID string, audio bool) {
	t.Helper()
	tracks := `["camera"]`
	if audio {
		tracks = `["microphone","camera"]`
	}
	mediaReady := eventInput(sessionID, sequence, eventID, domain.EventCandidateMediaReady)
	mediaReady.Actor = domain.EventActorCandidate
	mediaReady.Payload = json.RawMessage(fmt.Sprintf(
		`{"candidate_participant_id":"candidate-session","audio":%t,"video":true,"published_tracks":%s}`,
		audio, tracks,
	))
	if _, err := service.IngestEvent(context.Background(), mediaReady); err != nil {
		t.Fatalf("candidate_media_ready returned error: %v", err)
	}
}

func TestServiceStartsRecordingWhenCandidateAudioReady(t *testing.T) {
	service, repo, egress, session := newRecordingService(t, true)
	sessionID := session.Session.ID

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", true)

	if len(egress.started) != 1 {
		t.Fatalf("expected exactly one egress start, got %d", len(egress.started))
	}
	start := egress.started[0]
	if start.RoomName != "prelude-"+sessionID {
		t.Fatalf("expected room prelude-%s, got %s", sessionID, start.RoomName)
	}
	if !strings.HasPrefix(start.ObjectKey, "recordings/"+sessionID+"/") {
		t.Fatalf("unexpected object key %s", start.ObjectKey)
	}
	recording, found, err := repo.ActiveRecordingForSession(context.Background(), sessionID)
	if err != nil || !found {
		t.Fatalf("expected an active recording (found=%v err=%v)", found, err)
	}
	if recording.Status != domain.RecordingStatusRecording {
		t.Fatalf("expected recording status, got %s", recording.Status)
	}
	if recording.EgressID != "eg_test_1" {
		t.Fatalf("expected egress id eg_test_1, got %s", recording.EgressID)
	}
	if recording.ObjectKey != start.ObjectKey {
		t.Fatalf("expected persisted object key %s, got %s", start.ObjectKey, recording.ObjectKey)
	}
}

func TestServiceDoesNotRecordWithoutConsent(t *testing.T) {
	service, repo, egress, session := newRecordingService(t, false)
	sessionID := session.Session.ID

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", true)

	if egress.attempts != 0 {
		t.Fatalf("expected no egress attempt without consent, got %d", egress.attempts)
	}
	if _, found, _ := repo.ActiveRecordingForSession(context.Background(), sessionID); found {
		t.Fatal("expected no recording without consent")
	}
}

func TestServiceDoesNotRecordWithPreAudioConsentVersion(t *testing.T) {
	// candidate-consent-v1 disclosed transcript evidence only — not that the
	// candidate's voice would be audio-recorded. Recording such a session would
	// exceed the consented scope, so consent alone is not enough: the copy version
	// must be one that disclosed audio recording.
	service, repo, egress, session := newRecordingService(t, false)
	sessionID := session.Session.ID
	repo.SetRecordingConsent(sessionID, application.RecordingConsent{
		Granted:     true,
		CopyVersion: "candidate-consent-v1",
	})

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", true)

	if egress.attempts != 0 {
		t.Fatalf("expected no egress attempt for a pre-audio consent version, got %d", egress.attempts)
	}
	if _, found, _ := repo.ActiveRecordingForSession(context.Background(), sessionID); found {
		t.Fatal("expected no recording when consent predates audio disclosure")
	}
}

func TestServiceDoesNotRecordWhenAudioNotReady(t *testing.T) {
	service, repo, egress, session := newRecordingService(t, true)
	sessionID := session.Session.ID

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", false)

	if egress.attempts != 0 {
		t.Fatalf("expected no egress attempt for video-only media, got %d", egress.attempts)
	}
	if _, found, _ := repo.ActiveRecordingForSession(context.Background(), sessionID); found {
		t.Fatal("expected no recording when audio is not ready")
	}
}

func TestServiceDoesNotStartSecondRecordingWhileActive(t *testing.T) {
	service, _, egress, session := newRecordingService(t, true)
	sessionID := session.Session.ID

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", true)
	ingestAgentJoined(t, service, sessionID, 3, "evt_agent")
	ingestMediaReady(t, service, sessionID, 4, "evt_media_2", true)

	if len(egress.started) != 1 {
		t.Fatalf("expected the active-recording guard to block a second start, got %d", len(egress.started))
	}
}

func TestServiceRecordingFailureDoesNotBreakIngestion(t *testing.T) {
	service, repo, egress, session := newRecordingService(t, true)
	egress.err = errors.New("egress unavailable")
	sessionID := session.Session.ID

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", true)

	if egress.attempts != 1 {
		t.Fatalf("expected one egress start attempt, got %d", egress.attempts)
	}

	got, err := service.GetSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if len(got.Events) != 2 {
		t.Fatalf("expected both events persisted despite egress failure, got %d", len(got.Events))
	}
	if _, found, _ := repo.ActiveRecordingForSession(context.Background(), sessionID); found {
		t.Fatal("a failed egress start must not leave an active recording")
	}
}

func TestServiceStopsRecordingOnSessionCompleted(t *testing.T) {
	service, _, egress, session := newRecordingService(t, true)
	sessionID := session.Session.ID

	ingestJoined(t, service, sessionID, 1, "evt_joined")
	ingestMediaReady(t, service, sessionID, 2, "evt_media", true)
	ingestAgentJoined(t, service, sessionID, 3, "evt_agent")

	completed := eventInput(sessionID, 4, "evt_completed", domain.EventSessionCompleted)
	completed.Payload = json.RawMessage(`{"completed_reason":"all_questions_completed","completed_questions":3,"total_questions":3}`)
	if _, err := service.IngestEvent(context.Background(), completed); err != nil {
		t.Fatalf("session_completed returned error: %v", err)
	}

	if len(egress.stopped) != 1 || egress.stopped[0] != "eg_test_1" {
		t.Fatalf("expected egress eg_test_1 to be stopped, got %v", egress.stopped)
	}
}

type fakeObjectStore struct {
	deleted []string
	err     error
}

func (f *fakeObjectStore) DeleteObject(_ context.Context, key string) error {
	if f.err != nil {
		return f.err
	}
	f.deleted = append(f.deleted, key)
	return nil
}

func seedAvailableRecording(t *testing.T, repo *store.MemoryStore, id string, objectKey string, endedAt time.Time) {
	t.Helper()
	startedAt := endedAt.Add(-3 * time.Minute)
	if err := repo.CreateRecording(context.Background(), domain.Recording{
		ID:        id,
		SessionID: "is_" + id,
		EgressID:  "eg_" + id,
		ObjectKey: objectKey,
		Status:    domain.RecordingStatusAvailable,
		Format:    "audio/ogg",
		StartedAt: startedAt,
		EndedAt:   &endedAt,
		CreatedAt: startedAt,
		UpdatedAt: endedAt,
	}); err != nil {
		t.Fatalf("seed available recording %s: %v", id, err)
	}
}

func newPurgeService(t *testing.T) (*application.Service, *store.MemoryStore, fixedClock) {
	t.Helper()
	clock := fixedClock{now: time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)

	return service, repo, clock
}

func TestPurgeExpiredRecordingsErasesObjectThenTombstones(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	objects := &fakeObjectStore{}
	service.SetObjectStore(objects)

	seedAvailableRecording(t, repo, "old", "recordings/is_old/1.ogg", clock.now.AddDate(0, 0, -100))

	cutoff := clock.now.AddDate(0, 0, -90)
	purged, err := service.PurgeExpiredRecordings(context.Background(), cutoff)
	if err != nil {
		t.Fatalf("PurgeExpiredRecordings returned error: %v", err)
	}
	if purged != 1 {
		t.Fatalf("expected 1 purged, got %d", purged)
	}
	if len(objects.deleted) != 1 || objects.deleted[0] != "recordings/is_old/1.ogg" {
		t.Fatalf("expected the audio object to be deleted, got %v", objects.deleted)
	}

	rec, found, err := repo.RecordingByEgressID(context.Background(), "eg_old")
	if err != nil || !found {
		t.Fatalf("expected the tombstone row (found=%v err=%v)", found, err)
	}
	if rec.Status != domain.RecordingStatusDeleted {
		t.Fatalf("expected deleted status, got %s", rec.Status)
	}
	if rec.ObjectKey != "" {
		t.Fatalf("expected object key cleared, got %q", rec.ObjectKey)
	}
	if rec.DeletedAt == nil || rec.DeletedReason != "retention" {
		t.Fatalf("expected deleted_at + reason=retention, got at=%v reason=%q", rec.DeletedAt, rec.DeletedReason)
	}
}

func TestPurgeExpiredRecordingsSkipsFreshAndNonAvailable(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	objects := &fakeObjectStore{}
	service.SetObjectStore(objects)

	// Within the retention window — must be kept.
	seedAvailableRecording(t, repo, "fresh", "recordings/is_fresh/1.ogg", clock.now.AddDate(0, 0, -1))
	// Old but still in-flight (status "recording", not "available") — only
	// finalized recordings are retention candidates, never a live one.
	seedRecording(t, repo, "is_inflight", "eg_inflight", clock.now.AddDate(0, 0, -200))

	purged, err := service.PurgeExpiredRecordings(context.Background(), clock.now.AddDate(0, 0, -90))
	if err != nil {
		t.Fatalf("PurgeExpiredRecordings returned error: %v", err)
	}
	if purged != 0 {
		t.Fatalf("expected nothing purged, got %d", purged)
	}
	if len(objects.deleted) != 0 {
		t.Fatalf("expected no object deletes, got %v", objects.deleted)
	}
}

func TestPurgeExpiredRecordingsKeepsRowWhenObjectDeleteFails(t *testing.T) {
	// Delete the object FIRST: if that fails, the row must stay "available" so the
	// next tick retries — never tombstone a row whose audio still exists.
	service, repo, clock := newPurgeService(t)
	service.SetObjectStore(&fakeObjectStore{err: errors.New("r2 unavailable")})

	seedAvailableRecording(t, repo, "old", "recordings/is_old/1.ogg", clock.now.AddDate(0, 0, -100))

	purged, err := service.PurgeExpiredRecordings(context.Background(), clock.now.AddDate(0, 0, -90))
	if err != nil {
		t.Fatalf("purge is best-effort and should not return an error, got %v", err)
	}
	if purged != 0 {
		t.Fatalf("expected 0 purged when the object delete fails, got %d", purged)
	}

	rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_old")
	if rec.Status != domain.RecordingStatusAvailable {
		t.Fatalf("expected the row to stay available for retry, got %s", rec.Status)
	}
	if rec.ObjectKey == "" {
		t.Fatal("object key must be preserved when the delete failed")
	}
}

func TestPurgeExpiredRecordingsNoOpWithoutObjectStore(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	seedAvailableRecording(t, repo, "old", "recordings/is_old/1.ogg", clock.now.AddDate(0, 0, -100))

	purged, err := service.PurgeExpiredRecordings(context.Background(), clock.now.AddDate(0, 0, -90))
	if err != nil {
		t.Fatalf("PurgeExpiredRecordings returned error: %v", err)
	}
	if purged != 0 {
		t.Fatalf("expected a no-op without an object store, got %d purged", purged)
	}
}

func mustCreateRecording(t *testing.T, repo *store.MemoryStore, id string, sessionID string, objectKey string, at time.Time) {
	t.Helper()
	if err := repo.CreateRecording(context.Background(), domain.Recording{
		ID:        id,
		SessionID: sessionID,
		EgressID:  "eg_" + id,
		ObjectKey: objectKey,
		Status:    domain.RecordingStatusAvailable,
		Format:    "audio/ogg",
		StartedAt: at,
		EndedAt:   &at,
		CreatedAt: at,
		UpdatedAt: at,
	}); err != nil {
		t.Fatalf("create recording %s: %v", id, err)
	}
}

func TestEraseRecordingsForSession(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	objects := &fakeObjectStore{}
	service.SetObjectStore(objects)

	const sessionID = "is_erase"
	// Two recordings for the same session (a reconnect makes it 1:N)...
	mustCreateRecording(t, repo, "a", sessionID, "recordings/is_erase/1.ogg", clock.now.Add(-10*time.Minute))
	mustCreateRecording(t, repo, "b", sessionID, "recordings/is_erase/2.ogg", clock.now.Add(-5*time.Minute))
	// ...and one for a different session, which must be left untouched.
	mustCreateRecording(t, repo, "other", "is_other", "recordings/is_other/1.ogg", clock.now.Add(-5*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("EraseRecordingsForSession returned error: %v", err)
	}
	if erased != 2 {
		t.Fatalf("expected 2 erased, got %d", erased)
	}
	if len(objects.deleted) != 2 {
		t.Fatalf("expected both audio objects deleted, got %v", objects.deleted)
	}
	for _, egressID := range []string{"eg_a", "eg_b"} {
		rec, _, _ := repo.RecordingByEgressID(context.Background(), egressID)
		if rec.Status != domain.RecordingStatusDeleted || rec.ObjectKey != "" || rec.DeletedReason != "erasure_request" {
			t.Fatalf("expected %s tombstoned with reason erasure_request, got %+v", egressID, rec)
		}
	}
	if other, _, _ := repo.RecordingByEgressID(context.Background(), "eg_other"); other.Status != domain.RecordingStatusAvailable {
		t.Fatalf("a different session's recording must be untouched, got %s", other.Status)
	}

	// Idempotent: a re-run erases nothing more and deletes no further objects.
	erased2, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("idempotent erase returned error: %v", err)
	}
	if erased2 != 0 {
		t.Fatalf("expected a re-run to erase nothing, got %d", erased2)
	}
	if len(objects.deleted) != 2 {
		t.Fatalf("a re-run must not delete more objects, got %v", objects.deleted)
	}
}

func TestEraseRecordingsForSessionStopsInFlightWithoutOrphaning(t *testing.T) {
	// Erasing a session with a still-running egress must NOT tombstone the
	// in-flight row: its object does not exist yet, so deleting + tombstoning now
	// would let the egress land an orphan. Instead the egress is stopped and the
	// row left to finalize, while finalized recordings are erased normally.
	service, repo, clock := newPurgeService(t)
	objects := &fakeObjectStore{}
	service.SetObjectStore(objects)
	egress := &fakeEgress{}
	service.SetEgressGateway(egress)

	const sessionID = "is_mix"
	mustCreateRecording(t, repo, "done", sessionID, "recordings/is_mix/1.ogg", clock.now.Add(-10*time.Minute))
	if err := repo.CreateRecording(context.Background(), domain.Recording{
		ID:        "live",
		SessionID: sessionID,
		EgressID:  "eg_live",
		ObjectKey: "recordings/is_mix/2.ogg",
		Status:    domain.RecordingStatusRecording,
		Format:    "audio/ogg",
		StartedAt: clock.now.Add(-1 * time.Minute),
		CreatedAt: clock.now,
		UpdatedAt: clock.now,
	}); err != nil {
		t.Fatalf("seed in-flight recording: %v", err)
	}

	erased, err := service.EraseRecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("EraseRecordingsForSession returned error: %v", err)
	}
	if erased != 1 {
		t.Fatalf("expected only the finalized recording erased, got %d", erased)
	}
	if len(objects.deleted) != 1 || objects.deleted[0] != "recordings/is_mix/1.ogg" {
		t.Fatalf("only the finalized object must be deleted, got %v", objects.deleted)
	}
	if len(egress.stopped) != 1 || egress.stopped[0] != "eg_live" {
		t.Fatalf("expected the in-flight egress eg_live to be stopped, got %v", egress.stopped)
	}
	live, _, _ := repo.RecordingByEgressID(context.Background(), "eg_live")
	if live.Status != domain.RecordingStatusRecording {
		t.Fatalf("the in-flight row must stay 'recording' (not tombstoned), got %s", live.Status)
	}
	if live.ObjectKey != "recordings/is_mix/2.ogg" {
		t.Fatalf("the in-flight object key must be preserved for a later purge, got %q", live.ObjectKey)
	}
}

func TestEraseRecordingsForSessionReportsObjectFailure(t *testing.T) {
	// A failed object delete must surface as an error so the caller retries, and
	// must leave the row "available" (never tombstone audio that still exists).
	service, repo, clock := newPurgeService(t)
	service.SetObjectStore(&fakeObjectStore{err: errors.New("r2 unavailable")})
	mustCreateRecording(t, repo, "x", "is_x", "recordings/is_x/1.ogg", clock.now.Add(-5*time.Minute))

	erased, err := service.EraseRecordingsForSession(context.Background(), "is_x")
	if err == nil {
		t.Fatal("expected an error when an object delete fails, so the caller retries")
	}
	if erased != 0 {
		t.Fatalf("expected 0 erased on failure, got %d", erased)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_x"); rec.Status != domain.RecordingStatusAvailable {
		t.Fatalf("expected the row to stay available for retry, got %s", rec.Status)
	}
}

func seedRecording(t *testing.T, repo *store.MemoryStore, sessionID string, egressID string, at time.Time) {
	t.Helper()
	if err := repo.CreateRecording(context.Background(), domain.Recording{
		ID:        "rec_" + egressID,
		SessionID: sessionID,
		EgressID:  egressID,
		ObjectKey: "recordings/" + sessionID + "/1.ogg",
		Status:    domain.RecordingStatusRecording,
		Format:    "audio/ogg",
		StartedAt: at,
		CreatedAt: at,
		UpdatedAt: at,
	}); err != nil {
		t.Fatalf("seed recording: %v", err)
	}
}

func TestServiceFinalizeRecordingMarksAvailableOnComplete(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)

	seedRecording(t, repo, "is_1", "eg_1", clock.now)

	durationMs := 180000
	if err := service.FinalizeRecording(context.Background(), application.FinalizeRecordingFromEgress{
		EgressID:   "eg_1",
		Status:     "EGRESS_COMPLETE",
		DurationMs: &durationMs,
		EndedAt:    clock.now.Add(3 * time.Minute),
	}); err != nil {
		t.Fatalf("FinalizeRecording returned error: %v", err)
	}

	recording, found, err := repo.RecordingByEgressID(context.Background(), "eg_1")
	if err != nil || !found {
		t.Fatalf("expected recording (found=%v err=%v)", found, err)
	}
	if recording.Status != domain.RecordingStatusAvailable {
		t.Fatalf("expected available, got %s", recording.Status)
	}
	if recording.DurationMs == nil || *recording.DurationMs != durationMs {
		t.Fatalf("expected persisted duration %d, got %v", durationMs, recording.DurationMs)
	}
}

func TestServiceFinalizeRecordingMarksFailedOnShortOrErroredEgress(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)

	// An instant candidate drop: egress completes but below the duration floor.
	seedRecording(t, repo, "is_short", "eg_short", clock.now)
	shortMs := 200
	if err := service.FinalizeRecording(context.Background(), application.FinalizeRecordingFromEgress{
		EgressID: "eg_short", Status: "EGRESS_COMPLETE", DurationMs: &shortMs,
	}); err != nil {
		t.Fatalf("FinalizeRecording (short) returned error: %v", err)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_short"); rec.Status != domain.RecordingStatusFailed {
		t.Fatalf("expected failed for sub-floor duration, got %s", rec.Status)
	}

	// An egress that errored out.
	seedRecording(t, repo, "is_err", "eg_err", clock.now)
	if err := service.FinalizeRecording(context.Background(), application.FinalizeRecordingFromEgress{
		EgressID: "eg_err", Status: "EGRESS_FAILED",
	}); err != nil {
		t.Fatalf("FinalizeRecording (failed) returned error: %v", err)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_err"); rec.Status != domain.RecordingStatusFailed {
		t.Fatalf("expected failed for errored egress, got %s", rec.Status)
	}
}

func TestServiceFinalizeRecordingAvailableWhenCompleteWithUnknownDuration(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)

	// The reconciliation/GetEgress path can report EGRESS_COMPLETE without a
	// duration — that must finalize as available, not failed.
	seedRecording(t, repo, "is_nodur", "eg_nodur", clock.now)
	if err := service.FinalizeRecording(context.Background(), application.FinalizeRecordingFromEgress{
		EgressID: "eg_nodur",
		Status:   "EGRESS_COMPLETE",
	}); err != nil {
		t.Fatalf("FinalizeRecording returned error: %v", err)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_nodur"); rec.Status != domain.RecordingStatusAvailable {
		t.Fatalf("expected available for a complete egress with unknown duration, got %s", rec.Status)
	}
}

func TestServiceReconcileFinalizesTerminalEgressOnly(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)
	durationMs := 90000
	egress := &fakeEgress{getState: map[string]application.EgressState{
		"eg_done":   {Status: "EGRESS_COMPLETE", DurationMs: &durationMs},
		"eg_active": {Status: "EGRESS_ACTIVE"},
	}}
	service.SetEgressGateway(egress)

	startedLongAgo := clock.now.Add(-30 * time.Minute)
	seedRecording(t, repo, "is_done", "eg_done", startedLongAgo)
	seedRecording(t, repo, "is_active", "eg_active", startedLongAgo)

	reconciled, err := service.ReconcileRecordings(context.Background(), clock.now.Add(-10*time.Minute))
	if err != nil {
		t.Fatalf("ReconcileRecordings returned error: %v", err)
	}
	if reconciled != 1 {
		t.Fatalf("expected 1 reconciled, got %d", reconciled)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_done"); rec.Status != domain.RecordingStatusAvailable {
		t.Fatalf("expected eg_done available, got %s", rec.Status)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_active"); rec.Status != domain.RecordingStatusRecording {
		t.Fatalf("expected eg_active still recording (egress not terminal), got %s", rec.Status)
	}
}

func TestServiceReconcileSkipsFreshRecordings(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetRecordingRepository(repo)
	durationMs := 90000
	egress := &fakeEgress{getState: map[string]application.EgressState{
		"eg_fresh": {Status: "EGRESS_COMPLETE", DurationMs: &durationMs},
	}}
	service.SetEgressGateway(egress)

	// Started after the cutoff: still within a plausible live interview, so it is
	// not yet a reconciliation candidate.
	seedRecording(t, repo, "is_fresh", "eg_fresh", clock.now.Add(-2*time.Minute))

	reconciled, err := service.ReconcileRecordings(context.Background(), clock.now.Add(-10*time.Minute))
	if err != nil {
		t.Fatalf("ReconcileRecordings returned error: %v", err)
	}
	if reconciled != 0 {
		t.Fatalf("expected 0 reconciled for a fresh recording, got %d", reconciled)
	}
	if rec, _, _ := repo.RecordingByEgressID(context.Background(), "eg_fresh"); rec.Status != domain.RecordingStatusRecording {
		t.Fatalf("expected eg_fresh untouched, got %s", rec.Status)
	}
}
