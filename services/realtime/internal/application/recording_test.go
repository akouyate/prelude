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
		repo.SetRecordingConsent(session.Session.ID, true)
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
