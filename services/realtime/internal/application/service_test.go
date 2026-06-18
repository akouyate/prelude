package application_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time {
	return c.now
}

type fakeLiveKit struct{}

func (fakeLiveKit) CreateJoin(_ context.Context, input application.LiveKitJoinInput) (application.LiveKitJoin, error) {
	return application.LiveKitJoin{
		RoomName:    input.RoomName,
		URL:         "wss://livekit.example.test",
		Token:       "mock_lk_" + input.SessionID + "_" + input.Participant,
		Participant: input.Participant,
		ExpiresAt:   time.Date(2026, 6, 17, 10, 15, 0, 0, time.UTC),
	}, nil
}

func TestServiceCreateSessionReturnsMockJoin(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	output, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		AllowedModalities: []domain.Modality{domain.ModalityAudio, domain.ModalityVideo},
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	if output.Session.ID == "" {
		t.Fatal("expected generated session id")
	}
	if output.Session.Status != domain.SessionStatusWaitingCandidate {
		t.Fatalf("expected waiting_candidate status, got %s", output.Session.Status)
	}
	if output.Join.RoomName != output.Session.LiveKitRoomName {
		t.Fatalf("expected join room %q, got %q", output.Session.LiveKitRoomName, output.Join.RoomName)
	}
	if output.Join.Token == "" {
		t.Fatal("expected mocked token")
	}
}

func eventInput(sessionID string, sequence int, eventID string, eventType domain.EventType) application.IngestEventInput {
	return application.IngestEventInput{
		SessionID:      sessionID,
		EventID:        eventID,
		Type:           eventType,
		Actor:          domain.EventActorAgent,
		Sequence:       sequence,
		IdempotencyKey: eventID + ":idempotency",
		Payload:        json.RawMessage(`{"source":"agent"}`),
	}
}

func TestServiceGetAgentConfigReturnsAgentJoinAndDemoPlan(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	created, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	config, err := service.GetAgentConfig(context.Background(), created.Session.ID)
	if err != nil {
		t.Fatalf("GetAgentConfig returned error: %v", err)
	}

	if config.Session.ID != created.Session.ID {
		t.Fatalf("expected session %s, got %s", created.Session.ID, config.Session.ID)
	}
	if config.LiveKitJoin.Participant != "agent-"+created.Session.ID {
		t.Fatalf("expected agent participant, got %s", config.LiveKitJoin.Participant)
	}
	if config.LiveKitJoin.Token == created.Join.Token {
		t.Fatal("expected agent and candidate tokens to differ")
	}
	if config.InterviewPlan.ID != created.Session.InterviewPlanID {
		t.Fatalf("expected plan id %s, got %s", created.Session.InterviewPlanID, config.InterviewPlan.ID)
	}
	if len(config.InterviewPlan.Questions) == 0 {
		t.Fatal("expected questions in agent config")
	}
}

func TestServiceCreateSessionRejectsUnknownModality(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	_, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		AllowedModalities: []domain.Modality{domain.Modality("telepathy")},
	})
	if !errors.Is(err, application.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestServiceIngestEventIsIdempotent(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	input := application.IngestEventInput{
		SessionID:      session.Session.ID,
		EventID:        "evt_123",
		Type:           domain.EventSessionStarted,
		Actor:          domain.EventActorAgent,
		Sequence:       1,
		IdempotencyKey: "evt_123:idempotency",
		Payload:        json.RawMessage(`{"source":"agent"}`),
	}

	first, err := service.IngestEvent(context.Background(), input)
	if err != nil {
		t.Fatalf("first IngestEvent returned error: %v", err)
	}
	if first.Duplicate {
		t.Fatal("first event should not be duplicate")
	}

	second, err := service.IngestEvent(context.Background(), input)
	if err != nil {
		t.Fatalf("second IngestEvent returned error: %v", err)
	}
	if !second.Duplicate {
		t.Fatal("second event should be duplicate")
	}
}

func TestServiceIngestEventRejectsConflictingDuplicateID(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	_, err = service.IngestEvent(context.Background(), eventInput(session.Session.ID, 1, "evt_123", domain.EventSessionStarted))
	if err != nil {
		t.Fatalf("first IngestEvent returned error: %v", err)
	}

	_, err = service.IngestEvent(context.Background(), application.IngestEventInput{
		SessionID:      session.Session.ID,
		EventID:        "evt_123",
		Type:           domain.EventSessionStarted,
		Actor:          domain.EventActorAgent,
		Sequence:       1,
		IdempotencyKey: "evt_123:idempotency",
		Payload:        json.RawMessage(`{"source":"candidate"}`),
	})
	if !errors.Is(err, application.ErrEventConflict) {
		t.Fatalf("expected ErrEventConflict, got %v", err)
	}
}

func TestServiceIngestEventTransitionsSessionState(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	_, err = service.IngestEvent(context.Background(), eventInput(session.Session.ID, 1, "evt_started", domain.EventSessionStarted))
	if err != nil {
		t.Fatalf("session_started returned error: %v", err)
	}

	inProgress, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if inProgress.Status != domain.SessionStatusInProgress {
		t.Fatalf("expected in_progress, got %s", inProgress.Status)
	}

	_, err = service.IngestEvent(context.Background(), eventInput(session.Session.ID, 2, "evt_completed", domain.EventSessionCompleted))
	if err != nil {
		t.Fatalf("session_completed returned error: %v", err)
	}

	completed, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if completed.Status != domain.SessionStatusCompleted {
		t.Fatalf("expected completed, got %s", completed.Status)
	}
}

func TestServiceRejectsOutOfOrderQuestionEvent(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	input := eventInput(session.Session.ID, 1, "evt_question", domain.EventQuestionAsked)
	input.Payload = json.RawMessage(`{"question_id":"q_1"}`)
	_, err = service.IngestEvent(context.Background(), input)
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
	}
}

func TestServiceRejectsUnknownEventType(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	_, err = service.IngestEvent(context.Background(), eventInput(session.Session.ID, 1, "evt_unknown", domain.EventType("candidate_started_singing")))
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
	}
}

func TestServiceAcceptsInterviewerStateMachineControlEvents(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	events := []application.IngestEventInput{
		eventInput(session.Session.ID, 1, "evt_started", domain.EventSessionStarted),
		eventInput(session.Session.ID, 2, "evt_question", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 3, "evt_repeat", domain.EventQuestionRepeated),
		eventInput(session.Session.ID, 4, "evt_turn", domain.EventCandidateTurnStarted),
		eventInput(session.Session.ID, 5, "evt_finalized", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 6, "evt_reprompt", domain.EventSoftReprompted),
		eventInput(session.Session.ID, 7, "evt_completed", domain.EventQuestionCompleted),
		eventInput(session.Session.ID, 8, "evt_closing", domain.EventSessionClosing),
		eventInput(session.Session.ID, 9, "evt_done", domain.EventSessionCompleted),
	}

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.Type, err)
		}
	}

	completed, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if completed.Status != domain.SessionStatusCompleted {
		t.Fatalf("expected completed status, got %s", completed.Status)
	}
}

func TestServiceAcceptsTurnTakingGuardrailEvents(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	events := []struct {
		eventType domain.EventType
		actor     domain.EventActor
		payload   json.RawMessage
	}{
		{domain.EventSessionStarted, domain.EventActorAgent, json.RawMessage(`{"provider":"mock"}`)},
		{domain.EventAgentSpeechStarted, domain.EventActorAgent, json.RawMessage(`{"question_id":"q1","utterance_id":"q1:question:0"}`)},
		{domain.EventCandidateSpeechStarted, domain.EventActorCandidate, json.RawMessage(`{"question_id":"q1"}`)},
		{domain.EventBargeInDetected, domain.EventActorCandidate, json.RawMessage(`{"utterance_id":"q1:question:0","overlap_ms":340}`)},
		{domain.EventBargeInRejected, domain.EventActorSystem, json.RawMessage(`{"reason":"backchannel","observed_speech_ms":180}`)},
		{domain.EventBackchannelDetected, domain.EventActorSystem, json.RawMessage(`{"reason":"backchannel","observed_speech_ms":180}`)},
		{domain.EventCandidateSpeechStopped, domain.EventActorCandidate, json.RawMessage(`{"question_id":"q1"}`)},
		{domain.EventCandidateTurnDetected, domain.EventActorSystem, json.RawMessage(`{"question_id":"q1","semantic_complete":true}`)},
		{domain.EventWaitRequested, domain.EventActorCandidate, json.RawMessage(`{"question_id":"q1","reason":"candidate_requested_time"}`)},
		{domain.EventSilenceTimeoutStarted, domain.EventActorSystem, json.RawMessage(`{"question_id":"q1","tier":"soft_prompt","threshold_ms":10000}`)},
		{domain.EventBargeInAccepted, domain.EventActorSystem, json.RawMessage(`{"utterance_id":"q1:question:0","cancel_latency_ms":120}`)},
		{domain.EventAgentSpeechInterrupted, domain.EventActorSystem, json.RawMessage(`{"utterance_id":"q1:question:0","cancel_agent_audio":true}`)},
		{domain.EventAgentSpeechCompleted, domain.EventActorAgent, json.RawMessage(`{"utterance_id":"q1:question:0"}`)},
	}

	for index, event := range events {
		input := eventInput(session.Session.ID, index+1, "evt_turn_taking_"+string(event.eventType), event.eventType)
		input.Actor = event.actor
		input.Payload = event.payload
		if _, err := service.IngestEvent(context.Background(), input); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.eventType, err)
		}
	}

	got, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if len(got.Events) != len(events) {
		t.Fatalf("expected %d events, got %d", len(events), len(got.Events))
	}
	if got.Events[2].Actor != domain.EventActorCandidate {
		t.Fatalf("expected candidate actor, got %s", got.Events[2].Actor)
	}
	if string(got.Events[3].Payload) != `{"utterance_id":"q1:question:0","overlap_ms":340}` {
		t.Fatalf("expected barge-in payload roundtrip, got %s", string(got.Events[3].Payload))
	}
}

func TestServiceRejectsTurnTakingEventsBeforeSessionStarts(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	input := eventInput(session.Session.ID, 1, "evt_candidate_speech", domain.EventCandidateSpeechStarted)
	input.Actor = domain.EventActorCandidate
	_, err = service.IngestEvent(context.Background(), input)
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
	}
}

func TestServiceRejectsMissingEventActor(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	input := eventInput(session.Session.ID, 1, "evt_started", domain.EventSessionStarted)
	input.Actor = ""
	_, err = service.IngestEvent(context.Background(), input)
	if !errors.Is(err, application.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestServiceReturnsEventsInSequenceOrder(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	events := []application.IngestEventInput{
		{
			SessionID:      session.Session.ID,
			EventID:        "evt_started",
			Type:           domain.EventSessionStarted,
			Actor:          domain.EventActorAgent,
			Sequence:       1,
			IdempotencyKey: "evt_started:idempotency",
			OccurredAt:     time.Date(2026, 6, 17, 10, 0, 1, 0, time.UTC),
			Payload:        json.RawMessage(`{}`),
		},
		{
			SessionID:      session.Session.ID,
			EventID:        "evt_turn",
			Type:           domain.EventCandidateTurnStarted,
			Actor:          domain.EventActorCandidate,
			Sequence:       2,
			IdempotencyKey: "evt_turn:idempotency",
			OccurredAt:     time.Date(2026, 6, 17, 10, 0, 3, 0, time.UTC),
			Payload:        json.RawMessage(`{}`),
		},
		{
			SessionID:      session.Session.ID,
			EventID:        "evt_question",
			Type:           domain.EventQuestionAsked,
			Actor:          domain.EventActorAgent,
			Sequence:       3,
			IdempotencyKey: "evt_question:idempotency",
			OccurredAt:     time.Date(2026, 6, 17, 10, 0, 2, 0, time.UTC),
			Payload:        json.RawMessage(`{"question_id":"q_1"}`),
		},
	}

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.EventID, err)
		}
	}

	got, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if len(got.Events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(got.Events))
	}
	if got.Events[0].ID != "evt_started" || got.Events[1].ID != "evt_turn" || got.Events[2].ID != "evt_question" {
		t.Fatalf("expected chronological events, got %s, %s, %s", got.Events[0].ID, got.Events[1].ID, got.Events[2].ID)
	}
}
