package application_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

// seedTranscriptSession drives a real session to in_progress and appends one
// candidate turn carrying transcript text, so the erasure tests operate on the
// same rows the recruiter transcript is read from — not on hand-built fixtures.
func seedTranscriptSession(t *testing.T, service *application.Service) string {
	t.Helper()

	created, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_erase",
		CandidateID:       "candidate_erase",
		AllowedModalities: []domain.Modality{domain.ModalityAudio},
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	sessionID := created.Session.ID

	appendEvent(t, service, sessionID, 1, domain.EventCandidateJoined, domain.EventActorCandidate, map[string]any{
		"candidate_participant_id": "participant_erase",
		"modes":                    []string{string(domain.ModalityAudio)},
	})
	appendEvent(t, service, sessionID, 2, domain.EventAgentJoined, domain.EventActorAgent, nil)
	appendEvent(t, service, sessionID, 3, domain.EventCandidateTurnFinalized, domain.EventActorCandidate, map[string]any{
		"question_id":       "q1",
		"completion_reason": "answered",
		"transcript_turn": map[string]any{
			"question_id": "q1",
			"session_id":  sessionID,
			"started_at":  "2026-06-23T10:03:00Z",
			"ended_at":    "2026-06-23T10:03:20Z",
			"turn_id":     "turn_1",
			"speaker":     string(domain.TranscriptSpeakerCandidate),
			"text":        "I led the migration at my previous employer.",
			"is_final":    true,
		},
	})

	turns, err := service.GetTranscript(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("GetTranscript returned error: %v", err)
	}
	if len(turns) == 0 {
		t.Fatal("seed produced no transcript turns; the fixture is not exercising the transcript")
	}

	return sessionID
}

func appendEvent(t *testing.T, service *application.Service, sessionID string, sequence int, eventType domain.EventType, actor domain.EventActor, payload map[string]any) {
	t.Helper()

	encoded := json.RawMessage("{}")
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		encoded = raw
	}

	key := fmt.Sprintf("%s-%s-%d", eventType, sessionID, sequence)
	if _, err := service.IngestEvent(context.Background(), application.IngestEventInput{
		SessionID:      sessionID,
		EventID:        "ev_" + key,
		Type:           eventType,
		Actor:          actor,
		Sequence:       sequence,
		IdempotencyKey: key,
		OccurredAt:     time.Date(2026, 6, 23, 10, sequence, 0, 0, time.UTC),
		Payload:        encoded,
	}); err != nil {
		t.Fatalf("IngestEvent(%s) returned error: %v", eventType, err)
	}
}

func TestErasePersonalDataDeletesTranscriptEventsAndRecordings(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	service.SetTranscriptRepository(repo)
	objects := &fakeObjectStore{}
	service.SetObjectStore(objects)

	sessionID := seedTranscriptSession(t, service)
	mustCreateRecording(t, repo, "erase_a", sessionID, "recordings/"+sessionID+"/1.ogg", clock.now.Add(-5*time.Minute))

	report, err := service.ErasePersonalDataForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("ErasePersonalDataForSession returned error: %v", err)
	}
	if report.RecordingsErased != 1 {
		t.Fatalf("expected 1 recording erased, got %d", report.RecordingsErased)
	}
	if report.EventsErased == 0 {
		t.Fatal("expected the transcript events to be deleted, got 0")
	}

	// Physical deletion, not redaction: no event survives to be read back.
	turns, err := service.GetTranscript(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("GetTranscript after erasure returned error: %v", err)
	}
	if len(turns) != 0 {
		t.Fatalf("expected no transcript turns after erasure, got %d", len(turns))
	}
}

func TestErasePersonalDataKeepsTheContentFreeTombstone(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	service.SetTranscriptRepository(repo)
	service.SetObjectStore(&fakeObjectStore{})

	sessionID := seedTranscriptSession(t, service)
	mustCreateRecording(t, repo, "erase_b", sessionID, "recordings/"+sessionID+"/1.ogg", clock.now.Add(-5*time.Minute))

	before, err := service.GetSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}

	if _, err := service.ErasePersonalDataForSession(context.Background(), sessionID); err != nil {
		t.Fatalf("ErasePersonalDataForSession returned error: %v", err)
	}

	// Art. 17(3): the row itself survives — an interview took place, and when.
	after, err := service.GetSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("expected the session row to survive erasure, got error: %v", err)
	}
	if after.ID != before.ID || after.Status != before.Status || !after.CreatedAt.Equal(before.CreatedAt) {
		t.Fatalf("erasure must preserve id/status/timestamps: before=%+v after=%+v", before, after)
	}
	if len(after.Events) != 0 {
		t.Fatalf("expected the session to carry no events after erasure, got %d", len(after.Events))
	}

	// The recording tombstone survives too: it is the audit trace that audio
	// existed and was erased, and it carries no content.
	recordings, err := repo.RecordingsForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("RecordingsForSession returned error: %v", err)
	}
	if len(recordings) != 1 {
		t.Fatalf("expected the recording tombstone to be kept, got %d rows", len(recordings))
	}
	if recordings[0].Status != domain.RecordingStatusDeleted || recordings[0].ObjectKey != "" {
		t.Fatalf("expected a content-free tombstone, got %+v", recordings[0])
	}
}

func TestErasePersonalDataIsIdempotent(t *testing.T) {
	service, repo, clock := newPurgeService(t)
	service.SetTranscriptRepository(repo)
	objects := &fakeObjectStore{}
	service.SetObjectStore(objects)

	sessionID := seedTranscriptSession(t, service)
	mustCreateRecording(t, repo, "erase_c", sessionID, "recordings/"+sessionID+"/1.ogg", clock.now.Add(-5*time.Minute))

	first, err := service.ErasePersonalDataForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("first erasure returned error: %v", err)
	}

	second, err := service.ErasePersonalDataForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("second erasure returned error: %v", err)
	}
	if second.EventsErased != 0 || second.RecordingsErased != 0 {
		t.Fatalf("expected a re-run to erase nothing, got %+v", second)
	}
	if len(objects.deleted) != first.RecordingsErased {
		t.Fatalf("a re-run must not delete more objects, got %v", objects.deleted)
	}
}

func TestErasePersonalDataLeavesOtherSessionsUntouched(t *testing.T) {
	service, repo, _ := newPurgeService(t)
	service.SetTranscriptRepository(repo)
	service.SetObjectStore(&fakeObjectStore{})

	erased := seedTranscriptSession(t, service)
	kept := seedTranscriptSession(t, service)

	if _, err := service.ErasePersonalDataForSession(context.Background(), erased); err != nil {
		t.Fatalf("ErasePersonalDataForSession returned error: %v", err)
	}

	turns, err := service.GetTranscript(context.Background(), kept)
	if err != nil {
		t.Fatalf("GetTranscript for the other session returned error: %v", err)
	}
	if len(turns) == 0 {
		t.Fatal("erasing one session must not touch another session's transcript")
	}
}

func TestErasePersonalDataDeletesTranscriptEvenWhenAudioErasureFails(t *testing.T) {
	// The transcript's legal basis (Art. 6(1)(b)) is independent of the audio's
	// (Art. 6(1)(a)), so a failing object store must not hold the transcript
	// hostage. The error still surfaces, so the caller retries the audio.
	service, repo, clock := newPurgeService(t)
	service.SetTranscriptRepository(repo)
	service.SetObjectStore(&fakeObjectStore{err: errors.New("r2 unavailable")})

	sessionID := seedTranscriptSession(t, service)
	mustCreateRecording(t, repo, "erase_d", sessionID, "recordings/"+sessionID+"/1.ogg", clock.now.Add(-5*time.Minute))

	report, err := service.ErasePersonalDataForSession(context.Background(), sessionID)
	if err == nil {
		t.Fatal("expected the object-store failure to surface so the caller retries")
	}
	if report.EventsErased == 0 {
		t.Fatal("expected the transcript to be erased despite the audio failure")
	}

	turns, err := service.GetTranscript(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("GetTranscript returned error: %v", err)
	}
	if len(turns) != 0 {
		t.Fatalf("expected the transcript to be gone, got %d turns", len(turns))
	}
}

func TestErasePersonalDataErasesTranscriptWithoutRecordingSubsystem(t *testing.T) {
	// RECORDING_ENABLED is globally off today: no object store, no recording
	// repository. Erasure must still delete the transcript rather than no-op.
	clock := fixedClock{now: time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)}
	repo := store.NewMemoryStore()
	service := application.NewService(repo, fakeLiveKit{}, clock)
	service.SetTranscriptRepository(repo)

	sessionID := seedTranscriptSession(t, service)

	report, err := service.ErasePersonalDataForSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("ErasePersonalDataForSession returned error: %v", err)
	}
	if report.RecordingsErased != 0 {
		t.Fatalf("expected no recordings erased, got %d", report.RecordingsErased)
	}
	if report.EventsErased == 0 {
		t.Fatal("expected the transcript to be erased with recording disabled")
	}
}
