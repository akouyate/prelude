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

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time {
	return c.now
}

type fakeLiveKit struct{}

func (fakeLiveKit) EnsureRoom(_ context.Context, _ application.EnsureRoomInput) error {
	return nil
}

func (fakeLiveKit) CreateJoin(_ context.Context, input application.LiveKitJoinInput) (application.LiveKitJoin, error) {
	return application.LiveKitJoin{
		RoomName:    input.RoomName,
		URL:         "wss://livekit.example.test",
		Token:       "mock_lk_" + input.SessionID + "_" + input.Participant,
		Participant: input.Participant,
		ExpiresAt:   time.Date(2026, 6, 17, 10, 15, 0, 0, time.UTC),
	}, nil
}

type fakeAgentDispatchQueue struct {
	requests []application.AgentJoinRequest
	err      error
}

func (q *fakeAgentDispatchQueue) EnqueueAgentJoin(_ context.Context, request application.AgentJoinRequest) (application.AgentJoinDispatchResult, error) {
	if q.err != nil {
		return application.AgentJoinDispatchResult{}, q.err
	}

	q.requests = append(q.requests, request)
	return application.AgentJoinDispatchResult{Enqueued: true}, nil
}

type memoryStoreWithPlans struct {
	*store.MemoryStore
	plans map[string]application.InterviewPlan
}

func newMemoryStoreWithPlans(plans map[string]application.InterviewPlan) *memoryStoreWithPlans {
	return &memoryStoreWithPlans{
		MemoryStore: store.NewMemoryStore(),
		plans:       plans,
	}
}

func (s *memoryStoreWithPlans) GetInterviewPlan(_ context.Context, planID string) (application.InterviewPlan, error) {
	plan, ok := s.plans[planID]
	if !ok {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}

	return plan, nil
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

func validAnswerEvaluatedPayload(questionID string, turnID string, classification string, policyAction string) json.RawMessage {
	return json.RawMessage(`{
		"question_id": "` + questionID + `",
		"turn_ids": ["` + turnID + `"],
		"attempt_index": 1,
		"classification": "` + classification + `",
		"reason_codes": ["too_generic"],
		"policy_action": "` + policyAction + `",
		"confidence": 0.78,
		"evaluator_version": "answer-eval-v1"
	}`)
}

func validMatrixAnswerEvaluatedPayload(questionID string, turnID string) json.RawMessage {
	return json.RawMessage(`{
		"question_id": "` + questionID + `",
		"turn_ids": ["` + turnID + `"],
		"attempt_index": 1,
		"classification": "vague",
		"reason_codes": ["incoherent_or_absurd_answer"],
		"policy_action": "ask_followup",
		"confidence": 0.35,
		"evaluator_version": "answer-eval-matrix-v1",
		"evaluation_matrix": {
			"evaluator_mode": "heuristic_v1",
			"overall_score": 3,
			"max_score": 15,
			"dimensions": [
				{"name": "coherence", "score": 0, "rationale": "No usable coherence signal."},
				{"name": "relevance", "score": 0, "rationale": "No usable relevance signal."}
			],
			"challenge": {
				"needed": true,
				"reason": "incoherent_or_absurd_answer",
				"prompt": "Pouvez-vous repondre avec un exemple concret ?"
			}
		}
	}`)
}

func validStrongMatrixAnswerEvaluatedPayload(questionID string, turnID string) json.RawMessage {
	return json.RawMessage(`{
		"question_id": "` + questionID + `",
		"turn_ids": ["` + turnID + `"],
		"attempt_index": 1,
		"classification": "complete",
		"reason_codes": ["llm_assisted"],
		"policy_action": "complete_question",
		"confidence": 0.91,
		"evaluator_version": "answer-eval-matrix-v1",
		"evaluation_matrix": {
			"evaluator_mode": "llm_assisted",
			"overall_score": 13,
			"max_score": 15,
			"dimensions": [
				{"name": "clarity", "score": 3, "rationale": "Strong clarity signal."},
				{"name": "relevance", "score": 3, "rationale": "Strong relevance signal."},
				{"name": "concreteness", "score": 2, "rationale": "Usable but partial concreteness signal."},
				{"name": "coherence", "score": 3, "rationale": "Strong coherence signal."},
				{"name": "role_signal", "score": 2, "rationale": "Usable but partial role signal."}
			],
			"challenge": {
				"needed": false,
				"reason": "",
				"prompt": ""
			}
		}
	}`)
}

func validQuestionAskedPayload(sessionID string, questionID string, questionIndex int) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"question_id": %q,
		"question_index": %d,
		"prompt": "Pouvez-vous presenter votre parcours en quelques phrases ?",
		"transcript_turn": {
			"turn_id": "turn_interviewer_%d",
			"session_id": %q,
			"question_id": %q,
			"speaker": "interviewer",
			"text": "Pouvez-vous presenter votre parcours en quelques phrases ?",
			"is_final": true,
			"started_at": "2026-06-17T10:00:02Z",
			"ended_at": "2026-06-17T10:00:04Z"
		}
	}`, questionID, questionIndex, questionIndex+1, sessionID, questionID))
}

func validQuestionRepeatedPayload(sessionID string, questionID string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"question_id": %q,
		"prompt": "Pouvez-vous presenter votre parcours en quelques phrases ?",
		"reason": "candidate_requested_repeat",
		"transcript_turn": {
			"turn_id": "turn_repeat_1",
			"session_id": %q,
			"question_id": %q,
			"speaker": "interviewer",
			"text": "Pouvez-vous presenter votre parcours en quelques phrases ?",
			"is_final": true,
			"started_at": "2026-06-17T10:00:04Z",
			"ended_at": "2026-06-17T10:00:05Z"
		}
	}`, questionID, sessionID, questionID))
}

func validCandidateTurnFinalizedPayload(sessionID string, questionID string, turnID string, text string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"question_id": %q,
		"completion_reason": "answered",
		"transcript_turn": {
			"turn_id": %q,
			"session_id": %q,
			"question_id": %q,
			"speaker": "candidate",
			"text": %q,
			"is_final": true,
			"started_at": "2026-06-17T10:00:05Z",
			"ended_at": "2026-06-17T10:00:08Z",
			"confidence": 0.92
		}
	}`, questionID, turnID, sessionID, questionID, text))
}

func validSoftRepromptedPayload(sessionID string, questionID string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"question_id": %q,
		"prompt": "Pouvez-vous preciser en une ou deux phrases ?",
		"reprompts_used": 1,
		"attempt_index": 1,
		"transcript_turn": {
			"turn_id": "turn_reprompt_1",
			"session_id": %q,
			"question_id": %q,
			"speaker": "interviewer",
			"text": "Pouvez-vous preciser en une ou deux phrases ?",
			"is_final": true,
			"started_at": "2026-06-17T10:00:09Z",
			"ended_at": "2026-06-17T10:00:10Z"
		}
	}`, questionID, sessionID, questionID))
}

func validFollowupAskedPayload(sessionID string, questionID string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"question_id": %q,
		"followup_id": "followup_1",
		"prompt": "Quel exemple concret pouvez-vous donner ?",
		"followups_used": 1,
		"attempt_index": 1,
		"transcript_turn": {
			"turn_id": "turn_followup_1",
			"session_id": %q,
			"question_id": %q,
			"speaker": "interviewer",
			"text": "Quel exemple concret pouvez-vous donner ?",
			"is_final": true,
			"started_at": "2026-06-17T10:00:09Z",
			"ended_at": "2026-06-17T10:00:10Z"
		}
	}`, questionID, sessionID, questionID))
}

func validQuestionCompletedPayload(questionID string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"question_id": %q,
		"completion_reason": "answered",
		"attempt_index": 2
	}`, questionID))
}

func validSessionClosingPayload(sessionID string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{
		"completed_questions": 3,
		"total_questions": 3,
		"closing": "Merci, l'entretien est termine.",
		"transcript_turn": {
			"turn_id": "turn_closing",
			"session_id": %q,
			"speaker": "interviewer",
			"text": "Merci, l'entretien est termine.",
			"is_final": true,
			"started_at": "2026-06-17T10:05:00Z",
			"ended_at": "2026-06-17T10:05:02Z"
		}
	}`, sessionID))
}

func validSessionCompletedPayload() json.RawMessage {
	return json.RawMessage(`{
		"completed_reason": "all_questions_completed",
		"completed_questions": 3,
		"total_questions": 3
	}`)
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
	if config.InterviewPlan.InterviewStyle.Sector != "B2B SaaS" {
		t.Fatalf("expected interview style sector, got %s", config.InterviewPlan.InterviewStyle.Sector)
	}
	if len(config.InterviewPlan.InterviewStyle.RoleConstraints) == 0 {
		t.Fatal("expected role constraints in interview style")
	}
}

func TestServiceGetAgentConfigUsesRepositoryPlan(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	plan := application.InterviewPlan{
		ID:             "interview_real_123",
		RoleTitle:      "Warehouse Supervisor",
		Language:       "fr",
		AllowAudioOnly: true,
		Questions: []application.InterviewQuestion{
			{
				ID:       "availability",
				Prompt:   "What shift constraints should the recruiter know about?",
				Category: "logistics",
			},
		},
		InterviewStyle: application.InterviewStyle{
			Seniority: "mid",
		},
	}
	service := application.NewService(
		newMemoryStoreWithPlans(map[string]application.InterviewPlan{
			plan.ID: plan,
		}),
		fakeLiveKit{},
		clock,
	)

	created, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: plan.ID,
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	config, err := service.GetAgentConfig(context.Background(), created.Session.ID)
	if err != nil {
		t.Fatalf("GetAgentConfig returned error: %v", err)
	}

	// The provider is config-driven and defaults to "mock" (a valid
	// liveInterviewProviderSchema member) — never the bogus "repository" the
	// Python worker / canonical enum would reject.
	if config.Provider != "mock" {
		t.Fatalf("expected mock provider, got %s", config.Provider)
	}
	if config.InterviewPlan.RoleTitle != plan.RoleTitle {
		t.Fatalf("expected role title %q, got %q", plan.RoleTitle, config.InterviewPlan.RoleTitle)
	}
	if got := config.InterviewPlan.Questions[0].Prompt; got != plan.Questions[0].Prompt {
		t.Fatalf("expected repository question %q, got %q", plan.Questions[0].Prompt, got)
	}
}

func TestServiceGetAgentConfigProviderIsConfigurable(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	plan := application.InterviewPlan{
		ID:             "interview_real_provider",
		RoleTitle:      "Line Cook",
		AllowAudioOnly: true,
		Questions: []application.InterviewQuestion{
			{ID: "q1", Prompt: "Tell me about a busy service you handled.", Category: "experience"},
		},
	}
	service := application.NewService(
		newMemoryStoreWithPlans(map[string]application.InterviewPlan{plan.ID: plan}),
		fakeLiveKit{},
		clock,
	)
	service.SetProvider("openai_realtime")

	created, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: plan.ID,
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	config, err := service.GetAgentConfig(context.Background(), created.Session.ID)
	if err != nil {
		t.Fatalf("GetAgentConfig returned error: %v", err)
	}
	if config.Provider != "openai_realtime" {
		t.Fatalf("expected configured provider openai_realtime, got %s", config.Provider)
	}
}

func TestServiceGetRecruiterSummaryUsesRepositoryPlan(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	plan := application.InterviewPlan{
		ID:             "interview_real_summary",
		RoleTitle:      "Hotel Receptionist",
		Language:       "fr",
		AllowAudioOnly: true,
		Questions: []application.InterviewQuestion{
			{
				ID:       "guest-conflict",
				Prompt:   "How would you handle an unhappy guest at check-in?",
				Category: "judgment",
			},
		},
	}
	service := application.NewService(
		newMemoryStoreWithPlans(map[string]application.InterviewPlan{
			plan.ID: plan,
		}),
		fakeLiveKit{},
		clock,
	)

	created, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: plan.ID,
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	summary, err := service.GetRecruiterSummary(context.Background(), created.Session.ID)
	if err != nil {
		t.Fatalf("GetRecruiterSummary returned error: %v", err)
	}

	if summary.RoleTitle != plan.RoleTitle {
		t.Fatalf("expected role title %q, got %q", plan.RoleTitle, summary.RoleTitle)
	}
	if summary.QuestionNotes[0].Prompt != plan.Questions[0].Prompt {
		t.Fatalf("expected summary question %q, got %q", plan.Questions[0].Prompt, summary.QuestionNotes[0].Prompt)
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

func TestServiceIngestEventRejectsMismatchedCandidateID(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	input := eventInput(session.Session.ID, 1, "evt_wrong_candidate", domain.EventSessionStarted)
	input.CandidateID = "candidate_other"

	_, err = service.IngestEvent(context.Background(), input)
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
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

	completedInput := eventInput(session.Session.ID, 2, "evt_completed", domain.EventSessionCompleted)
	completedInput.Payload = validSessionCompletedPayload()
	_, err = service.IngestEvent(context.Background(), completedInput)
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

func TestServiceAcceptsCandidateMediaReadinessBeforeAgentJoin(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		AllowedModalities: []domain.Modality{domain.ModalityAudio, domain.ModalityVideo},
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	joined := eventInput(session.Session.ID, 1, "evt_candidate_joined", domain.EventCandidateJoined)
	joined.Actor = domain.EventActorCandidate
	joined.Payload = json.RawMessage(`{
		"candidate_participant_id": "candidate-session",
		"room_name": "prelude-session-test",
		"modes": ["audio", "video"]
	}`)
	if _, err := service.IngestEvent(context.Background(), joined); err != nil {
		t.Fatalf("candidate_joined returned error: %v", err)
	}

	mediaReady := eventInput(session.Session.ID, 2, "evt_candidate_media_ready", domain.EventCandidateMediaReady)
	mediaReady.Actor = domain.EventActorCandidate
	mediaReady.Payload = json.RawMessage(`{
		"candidate_participant_id": "candidate-session",
		"room_name": "prelude-session-test",
		"audio": true,
		"video": true,
		"published_tracks": ["microphone", "camera"]
	}`)
	if _, err := service.IngestEvent(context.Background(), mediaReady); err != nil {
		t.Fatalf("candidate_media_ready returned error: %v", err)
	}

	got, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if got.Status != domain.SessionStatusAgentJoining {
		t.Fatalf("expected agent_joining, got %s", got.Status)
	}
	if len(got.Events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(got.Events))
	}
}

func TestServiceDispatchesAgentWhenCandidateMediaIsReady(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)
	dispatchQueue := &fakeAgentDispatchQueue{}
	service.SetAgentDispatchQueue(dispatchQueue)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		AllowedModalities: []domain.Modality{domain.ModalityAudio, domain.ModalityVideo},
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	joined := eventInput(session.Session.ID, 1, "evt_candidate_joined", domain.EventCandidateJoined)
	joined.Actor = domain.EventActorCandidate
	joined.Payload = json.RawMessage(`{
		"candidate_participant_id": "candidate-session",
		"room_name": "prelude-session-test",
		"modes": ["audio", "video"]
	}`)
	if _, err := service.IngestEvent(context.Background(), joined); err != nil {
		t.Fatalf("candidate_joined returned error: %v", err)
	}
	if len(dispatchQueue.requests) != 0 {
		t.Fatalf("expected no dispatch on candidate_joined, got %d", len(dispatchQueue.requests))
	}

	mediaReady := eventInput(session.Session.ID, 2, "evt_candidate_media_ready", domain.EventCandidateMediaReady)
	mediaReady.Actor = domain.EventActorCandidate
	mediaReady.Payload = json.RawMessage(`{
		"candidate_participant_id": "candidate-session",
		"room_name": "prelude-session-test",
		"audio": true,
		"video": true,
		"published_tracks": ["microphone", "camera"]
	}`)
	if _, err := service.IngestEvent(context.Background(), mediaReady); err != nil {
		t.Fatalf("candidate_media_ready returned error: %v", err)
	}

	if len(dispatchQueue.requests) != 1 {
		t.Fatalf("expected one dispatch request, got %d", len(dispatchQueue.requests))
	}
	request := dispatchQueue.requests[0]
	if request.SessionID != session.Session.ID {
		t.Fatalf("expected session id %q, got %q", session.Session.ID, request.SessionID)
	}
	if request.CandidateID != "candidate_123" {
		t.Fatalf("expected candidate id candidate_123, got %q", request.CandidateID)
	}
	if !request.RequestedAt.Equal(clock.now) {
		t.Fatalf("expected requested_at %s, got %s", clock.now, request.RequestedAt)
	}

	duplicate, err := service.IngestEvent(context.Background(), mediaReady)
	if err != nil {
		t.Fatalf("duplicate candidate_media_ready returned error: %v", err)
	}
	if !duplicate.Duplicate {
		t.Fatal("expected duplicate candidate_media_ready result")
	}
	if len(dispatchQueue.requests) != 1 {
		t.Fatalf("expected no extra dispatch for duplicate event, got %d requests", len(dispatchQueue.requests))
	}
}

func TestServiceDoesNotFailEventIngestionWhenAgentDispatchFails(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)
	service.SetAgentDispatchQueue(&fakeAgentDispatchQueue{err: errors.New("redis unavailable")})

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID:   "plan_123",
		CandidateID:       "candidate_123",
		AllowedModalities: []domain.Modality{domain.ModalityAudio, domain.ModalityVideo},
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}

	joined := eventInput(session.Session.ID, 1, "evt_candidate_joined", domain.EventCandidateJoined)
	joined.Actor = domain.EventActorCandidate
	joined.Payload = json.RawMessage(`{
		"candidate_participant_id": "candidate-session",
		"room_name": "prelude-session-test",
		"modes": ["audio", "video"]
	}`)
	if _, err := service.IngestEvent(context.Background(), joined); err != nil {
		t.Fatalf("candidate_joined returned error: %v", err)
	}

	mediaReady := eventInput(session.Session.ID, 2, "evt_candidate_media_ready", domain.EventCandidateMediaReady)
	mediaReady.Actor = domain.EventActorCandidate
	mediaReady.Payload = json.RawMessage(`{
		"candidate_participant_id": "candidate-session",
		"room_name": "prelude-session-test",
		"audio": true,
		"video": true,
		"published_tracks": ["microphone", "camera"]
	}`)
	if _, err := service.IngestEvent(context.Background(), mediaReady); err != nil {
		t.Fatalf("candidate_media_ready returned error despite dispatch failure: %v", err)
	}

	got, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if len(got.Events) != 2 {
		t.Fatalf("expected persisted events despite dispatch failure, got %d", len(got.Events))
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
	input.Payload = validQuestionAskedPayload(session.Session.ID, "q_1", 0)
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
		eventInput(session.Session.ID, 6, "evt_answer_eval", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 7, "evt_reprompt", domain.EventSoftReprompted),
		eventInput(session.Session.ID, 8, "evt_completed", domain.EventQuestionCompleted),
		eventInput(session.Session.ID, 9, "evt_closing", domain.EventSessionClosing),
		eventInput(session.Session.ID, 10, "evt_done", domain.EventSessionCompleted),
	}
	events[1].Payload = validQuestionAskedPayload(session.Session.ID, "q1", 0)
	events[2].Payload = validQuestionRepeatedPayload(session.Session.ID, "q1")
	events[4].Actor = domain.EventActorCandidate
	events[4].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_1",
		"Je peux donner un exemple concret.",
	)
	events[5].Actor = domain.EventActorSystem
	events[5].Payload = validAnswerEvaluatedPayload("q1", "turn_1", "incomplete", "soft_reprompt")
	events[6].Payload = validSoftRepromptedPayload(session.Session.ID, "q1")
	events[7].Payload = validQuestionCompletedPayload("q1")
	events[8].Payload = validSessionClosingPayload(session.Session.ID)
	events[9].Payload = validSessionCompletedPayload()

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

func TestServiceAcceptsAnswerEvaluatedEvent(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	if _, err := service.IngestEvent(context.Background(), eventInput(session.Session.ID, 1, "evt_started", domain.EventSessionStarted)); err != nil {
		t.Fatalf("session_started returned error: %v", err)
	}

	input := eventInput(session.Session.ID, 2, "evt_answer_eval", domain.EventAnswerEvaluated)
	input.Actor = domain.EventActorSystem
	input.Payload = validAnswerEvaluatedPayload("q1", "turn_1", "vague", "ask_followup")

	output, err := service.IngestEvent(context.Background(), input)
	if err != nil {
		t.Fatalf("answer_evaluated returned error: %v", err)
	}
	if output.Event.Type != domain.EventAnswerEvaluated {
		t.Fatalf("expected answer_evaluated, got %s", output.Event.Type)
	}
}

func TestServiceRejectsInvalidAnswerEvaluatedPayload(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	if _, err := service.IngestEvent(context.Background(), eventInput(session.Session.ID, 1, "evt_started", domain.EventSessionStarted)); err != nil {
		t.Fatalf("session_started returned error: %v", err)
	}

	input := eventInput(session.Session.ID, 2, "evt_answer_eval_bad", domain.EventAnswerEvaluated)
	input.Actor = domain.EventActorSystem
	input.Payload = validAnswerEvaluatedPayload("q1", "turn_1", "candidate_quality_score", "ask_followup")

	_, err = service.IngestEvent(context.Background(), input)
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
	}
}

func TestServiceRejectsInvalidMetricBearingPayloads(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 0, 0, 0, time.UTC)}
	service := application.NewService(store.NewMemoryStore(), fakeLiveKit{}, clock)

	session, err := service.CreateSession(context.Background(), application.CreateSessionInput{
		InterviewPlanID: "plan_123",
		CandidateID:     "candidate_123",
	})
	if err != nil {
		t.Fatalf("CreateSession returned error: %v", err)
	}
	if _, err := service.IngestEvent(context.Background(), eventInput(session.Session.ID, 1, "evt_started", domain.EventSessionStarted)); err != nil {
		t.Fatalf("session_started returned error: %v", err)
	}

	cases := []struct {
		name      string
		eventType domain.EventType
		actor     domain.EventActor
		payload   json.RawMessage
	}{
		{
			name:      "question asked missing index",
			eventType: domain.EventQuestionAsked,
			actor:     domain.EventActorAgent,
			payload:   json.RawMessage(`{"question_id":"q1","prompt":"Pouvez-vous presenter votre parcours ?"}`),
		},
		{
			name:      "candidate turn with interviewer speaker",
			eventType: domain.EventCandidateTurnFinalized,
			actor:     domain.EventActorCandidate,
			payload: json.RawMessage(`{
				"question_id": "q1",
				"completion_reason": "answered",
				"transcript_turn": {
					"turn_id": "turn_1",
					"session_id": "` + session.Session.ID + `",
					"question_id": "q1",
					"speaker": "interviewer",
					"text": "Mauvais speaker pour un tour candidat.",
					"started_at": "2026-06-17T10:00:05Z"
				}
			}`),
		},
		{
			name:      "session completed impossible counters",
			eventType: domain.EventSessionCompleted,
			actor:     domain.EventActorAgent,
			payload:   json.RawMessage(`{"completed_reason":"all_questions_completed","completed_questions":4,"total_questions":3}`),
		},
		{
			name:      "legacy session failed shape",
			eventType: domain.EventSessionFailed,
			actor:     domain.EventActorAgent,
			payload:   json.RawMessage(`{"error":"boom","error_type":"RuntimeError"}`),
		},
		{
			name:      "negative barge in latency",
			eventType: domain.EventBargeInAccepted,
			actor:     domain.EventActorSystem,
			payload:   json.RawMessage(`{"utterance_id":"q1:question:0","cancel_latency_ms":-1}`),
		},
		{
			name:      "media ready without microphone track",
			eventType: domain.EventCandidateMediaReady,
			actor:     domain.EventActorCandidate,
			payload: json.RawMessage(`{
				"candidate_participant_id": "candidate-session",
				"audio": true,
				"video": false,
				"published_tracks": ["camera"]
			}`),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := eventInput(session.Session.ID, 2, "evt_invalid_"+tc.name, tc.eventType)
			input.Actor = tc.actor
			input.Payload = tc.payload

			_, err := service.IngestEvent(context.Background(), input)
			if !errors.Is(err, application.ErrInvalidEvent) {
				t.Fatalf("expected ErrInvalidEvent, got %v", err)
			}
		})
	}
}

func TestServiceRejectsSensitiveKeysInEventPayloads(t *testing.T) {
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
	input.ProviderMetadata = json.RawMessage(`{"openai_api_key":"sk-test"}`)

	_, err = service.IngestEvent(context.Background(), input)
	if !errors.Is(err, application.ErrInvalidEvent) {
		t.Fatalf("expected ErrInvalidEvent, got %v", err)
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
		{domain.EventAgentSpeechInterrupted, domain.EventActorSystem, json.RawMessage(`{"utterance_id":"q1:question:0","cancel_latency_ms":120,"cancel_agent_audio":true}`)},
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
			Payload:        validQuestionAskedPayload(session.Session.ID, "q_1", 0),
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

func TestServicePersistsReplayableSmokeMetrics(t *testing.T) {
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
		eventInput(session.Session.ID, 2, "evt_q1", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 3, "evt_q1_turn_1", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 4, "evt_q1_eval_1", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 5, "evt_q1_followup", domain.EventFollowupAsked),
		eventInput(session.Session.ID, 6, "evt_q1_turn_2", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 7, "evt_q1_eval_2", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 8, "evt_q1_done", domain.EventQuestionCompleted),
		eventInput(session.Session.ID, 9, "evt_q2", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 10, "evt_q2_barge", domain.EventBargeInDetected),
		eventInput(session.Session.ID, 11, "evt_q2_barge_ok", domain.EventBargeInAccepted),
		eventInput(session.Session.ID, 12, "evt_q2_interrupted", domain.EventAgentSpeechInterrupted),
		eventInput(session.Session.ID, 13, "evt_q2_turn", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 14, "evt_q2_eval", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 15, "evt_q2_done", domain.EventQuestionCompleted),
		eventInput(session.Session.ID, 16, "evt_q3", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 17, "evt_q3_turn", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 18, "evt_q3_eval", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 19, "evt_q3_done", domain.EventQuestionCompleted),
		eventInput(session.Session.ID, 20, "evt_closing", domain.EventSessionClosing),
		eventInput(session.Session.ID, 21, "evt_completed", domain.EventSessionCompleted),
	}
	events[1].Payload = validQuestionAskedPayload(session.Session.ID, "q1", 0)
	events[2].Actor = domain.EventActorCandidate
	events[2].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_q1_1",
		"J'ai une experience pertinente, mais je peux donner plus de details.",
	)
	events[3].Actor = domain.EventActorSystem
	events[3].Payload = validAnswerEvaluatedPayload("q1", "turn_q1_1", "vague", "ask_followup")
	events[4].Payload = validFollowupAskedPayload(session.Session.ID, "q1")
	events[5].Actor = domain.EventActorCandidate
	events[5].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_q1_2",
		"Je peux illustrer avec un exemple concret et le resultat obtenu.",
	)
	events[6].Actor = domain.EventActorSystem
	events[6].Payload = validAnswerEvaluatedPayload("q1", "turn_q1_2", "complete", "complete_question")
	events[7].Payload = validQuestionCompletedPayload("q1")
	events[8].Payload = validQuestionAskedPayload(session.Session.ID, "q2", 1)
	events[9].Actor = domain.EventActorCandidate
	events[9].Payload = json.RawMessage(`{
		"utterance_id": "q2:question:1",
		"question_id": "q2",
		"overlap_ms": 340,
		"candidate_speech_ms": 340,
		"confidence": 0.92
	}`)
	events[10].Actor = domain.EventActorSystem
	events[10].Payload = json.RawMessage(`{
		"utterance_id": "q2:question:1",
		"question_id": "q2",
		"cancel_latency_ms": 120,
		"truncated_at_ms": 340
	}`)
	events[11].Actor = domain.EventActorSystem
	events[11].Payload = json.RawMessage(`{
		"utterance_id": "q2:question:1",
		"question_id": "q2",
		"cancel_latency_ms": 120,
		"truncated_at_ms": 340,
		"cancel_agent_audio": true
	}`)
	events[12].Actor = domain.EventActorCandidate
	events[12].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q2",
		"turn_q2_1",
		"J'ai priorise une roadmap sous contrainte forte.",
	)
	events[13].Actor = domain.EventActorSystem
	events[13].Payload = validAnswerEvaluatedPayload("q2", "turn_q2_1", "complete", "complete_question")
	events[14].Payload = validQuestionCompletedPayload("q2")
	events[15].Payload = validQuestionAskedPayload(session.Session.ID, "q3", 2)
	events[16].Actor = domain.EventActorCandidate
	events[16].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q3",
		"turn_q3_1",
		"Je suis disponible sous un mois avec deux jours de preavis.",
	)
	events[17].Actor = domain.EventActorSystem
	events[17].Payload = validAnswerEvaluatedPayload("q3", "turn_q3_1", "complete", "complete_question")
	events[18].Payload = validQuestionCompletedPayload("q3")
	events[19].Payload = validSessionClosingPayload(session.Session.ID)
	events[20].Payload = validSessionCompletedPayload()

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.EventID, err)
		}
	}

	got, err := service.GetSession(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetSession returned error: %v", err)
	}
	if got.Status != domain.SessionStatusCompleted {
		t.Fatalf("expected completed session, got %s", got.Status)
	}
	if len(got.Events) != len(events) {
		t.Fatalf("expected %d events, got %d", len(events), len(got.Events))
	}

	counts := map[domain.EventType]int{}
	for index, event := range got.Events {
		if event.Sequence != index+1 {
			t.Fatalf("expected contiguous sequence %d, got %d", index+1, event.Sequence)
		}
		if event.CandidateID != session.Session.CandidateID {
			t.Fatalf("expected candidate id %s, got %s", session.Session.CandidateID, event.CandidateID)
		}
		counts[event.Type]++
	}
	if counts[domain.EventQuestionCompleted] != 3 {
		t.Fatalf("expected 3 completed questions, got %d", counts[domain.EventQuestionCompleted])
	}
	if counts[domain.EventFollowupAsked] != 1 {
		t.Fatalf("expected 1 follow-up, got %d", counts[domain.EventFollowupAsked])
	}
	if counts[domain.EventBargeInDetected] != 1 {
		t.Fatalf("expected 1 barge-in, got %d", counts[domain.EventBargeInDetected])
	}
	if counts[domain.EventAnswerEvaluated] != 4 {
		t.Fatalf("expected 4 answer evaluations, got %d", counts[domain.EventAnswerEvaluated])
	}

	var completedPayload struct {
		CompletedReason    string `json:"completed_reason"`
		CompletedQuestions int    `json:"completed_questions"`
		TotalQuestions     int    `json:"total_questions"`
	}
	if err := json.Unmarshal(got.Events[len(got.Events)-1].Payload, &completedPayload); err != nil {
		t.Fatalf("failed to decode completion payload: %v", err)
	}
	if completedPayload.CompletedReason != "all_questions_completed" ||
		completedPayload.CompletedQuestions != 3 ||
		completedPayload.TotalQuestions != 3 {
		t.Fatalf("unexpected terminal counters: %#v", completedPayload)
	}

	transcript, err := service.GetTranscript(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetTranscript returned error: %v", err)
	}
	if len(transcript) != 9 {
		t.Fatalf("expected 9 transcript turns, got %d", len(transcript))
	}
	if transcript[0].Speaker != domain.TranscriptSpeakerInterviewer {
		t.Fatalf("expected interviewer to open transcript, got %s", transcript[0].Speaker)
	}
	candidateTurns := 0
	interviewerTurns := 0
	for _, turn := range transcript {
		switch turn.Speaker {
		case domain.TranscriptSpeakerCandidate:
			candidateTurns++
		case domain.TranscriptSpeakerInterviewer:
			interviewerTurns++
		}
	}
	if candidateTurns != 4 || interviewerTurns != 5 {
		t.Fatalf("expected 4 candidate and 5 interviewer turns, got %d and %d", candidateTurns, interviewerTurns)
	}
}

func TestServiceReconstructsTranscriptFromFinalizedTurnEvents(t *testing.T) {
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

	input := eventInput(session.Session.ID, 2, "evt_finalized", domain.EventCandidateTurnFinalized)
	input.Actor = domain.EventActorCandidate
	input.Payload = json.RawMessage(`{
		"question_id": "q1",
		"completion_reason": "answered",
		"transcript_turn": {
			"turn_id": "turn_1",
			"session_id": "` + session.Session.ID + `",
			"question_id": "q1",
			"speaker": "candidate",
			"text": "Je peux gerer un portefeuille client SMB.",
			"is_final": true,
			"started_at": "2026-06-17T10:00:05Z",
			"ended_at": "2026-06-17T10:00:08Z",
			"confidence": 0.92
		}
	}`)
	_, err = service.IngestEvent(context.Background(), input)
	if err != nil {
		t.Fatalf("candidate_turn_finalized returned error: %v", err)
	}

	transcript, err := service.GetTranscript(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetTranscript returned error: %v", err)
	}
	if len(transcript) != 1 {
		t.Fatalf("expected 1 transcript turn, got %d", len(transcript))
	}
	if transcript[0].TurnID != "turn_1" || transcript[0].QuestionID != "q1" {
		t.Fatalf("unexpected transcript turn: %#v", transcript[0])
	}
	if transcript[0].Text != "Je peux gerer un portefeuille client SMB." {
		t.Fatalf("unexpected transcript text: %s", transcript[0].Text)
	}
	if transcript[0].Confidence == nil || *transcript[0].Confidence != 0.92 {
		t.Fatalf("expected confidence 0.92, got %#v", transcript[0].Confidence)
	}
}

func TestServiceReconstructsTranscriptFromAnyNormalizedTranscriptEvent(t *testing.T) {
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

	assistant := eventInput(session.Session.ID, 2, "evt_assistant_turn", domain.EventAgentSpeechCompleted)
	assistant.Actor = domain.EventActorAgent
	assistant.Payload = json.RawMessage(`{
		"transcript_turn": {
			"turn_id": "turn_interviewer_1",
			"session_id": "` + session.Session.ID + `",
			"speaker": "interviewer",
			"text": "Bonjour, pouvez-vous vous presenter ?",
			"is_final": true,
			"started_at": "2026-06-17T10:00:02Z",
			"ended_at": "2026-06-17T10:00:04Z"
		}
	}`)
	if _, err := service.IngestEvent(context.Background(), assistant); err != nil {
		t.Fatalf("assistant transcript event returned error: %v", err)
	}

	candidate := eventInput(session.Session.ID, 3, "evt_candidate_turn", domain.EventCandidateTurnFinalized)
	candidate.Actor = domain.EventActorCandidate
	candidate.Payload = json.RawMessage(`{
		"question_id": "q1",
		"completion_reason": "answered",
		"transcript_turn": {
			"turn_id": "turn_candidate_1",
			"session_id": "` + session.Session.ID + `",
			"question_id": "q1",
			"speaker": "candidate",
			"text": "Oui, je suis product manager.",
			"is_final": true,
			"started_at": "2026-06-17T10:00:05Z",
			"ended_at": "2026-06-17T10:00:08Z"
		}
	}`)
	if _, err := service.IngestEvent(context.Background(), candidate); err != nil {
		t.Fatalf("candidate transcript event returned error: %v", err)
	}

	transcript, err := service.GetTranscript(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetTranscript returned error: %v", err)
	}
	if len(transcript) != 2 {
		t.Fatalf("expected 2 transcript turns, got %d", len(transcript))
	}
	if transcript[0].Speaker != domain.TranscriptSpeakerInterviewer {
		t.Fatalf("expected interviewer first, got %s", transcript[0].Speaker)
	}
	if transcript[1].Speaker != domain.TranscriptSpeakerCandidate {
		t.Fatalf("expected candidate second, got %s", transcript[1].Speaker)
	}
}

func TestServiceBuildsRecruiterSummaryFromTranscriptEvents(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 45, 0, 0, time.UTC)}
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
		eventInput(session.Session.ID, 2, "evt_q1", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 3, "evt_turn_q1", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 4, "evt_eval_q1", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 5, "evt_q2", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 6, "evt_turn_q2", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 7, "evt_eval_q2", domain.EventAnswerEvaluated),
		eventInput(session.Session.ID, 8, "evt_completed", domain.EventSessionCompleted),
	}
	events[1].Payload = validQuestionAskedPayload(session.Session.ID, "q1", 0)
	events[2].Actor = domain.EventActorCandidate
	events[2].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_q1",
		"Je cherche un poste produit proche des clients B2B, avec des arbitrages concrets et une forte collaboration avec les equipes sales et success.",
	)
	events[3].Actor = domain.EventActorSystem
	events[3].Payload = validAnswerEvaluatedPayload("q1", "turn_q1", "complete", "complete_question")
	events[4].Payload = validQuestionAskedPayload(session.Session.ID, "q2", 1)
	events[5].Actor = domain.EventActorCandidate
	events[5].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q2",
		"turn_q2",
		"Dans mon dernier role, j'ai priorise une integration critique apres avoir compare l'impact client, le cout technique et le risque de churn.",
	)
	events[6].Actor = domain.EventActorSystem
	events[6].Payload = validAnswerEvaluatedPayload("q2", "turn_q2", "complete", "complete_question")
	events[7].Payload = json.RawMessage(`{
		"completed_reason": "all_questions_completed",
		"completed_questions": 2,
		"total_questions": 3
	}`)

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.Type, err)
		}
	}

	summary, err := service.GetRecruiterSummary(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetRecruiterSummary returned error: %v", err)
	}

	if summary.SummaryID != "rs_"+session.Session.ID {
		t.Fatalf("unexpected summary id %s", summary.SummaryID)
	}
	if summary.Status != "complete" {
		t.Fatalf("expected complete summary, got %s", summary.Status)
	}
	if summary.Recommendation.Value != "follow_up_required" {
		t.Fatalf("expected follow_up_required recommendation, got %s", summary.Recommendation.Value)
	}
	if len(summary.Criteria) != 3 {
		t.Fatalf("expected 3 criteria, got %d", len(summary.Criteria))
	}
	if summary.Criteria[0].Status != "satisfied" || summary.Criteria[2].Status != "missing" {
		t.Fatalf("unexpected criteria statuses: %#v", summary.Criteria)
	}
	if len(summary.Strengths) == 0 || len(summary.Strengths[0].Evidence) == 0 {
		t.Fatalf("expected grounded strength evidence, got %#v", summary.Strengths)
	}
	if len(summary.MissingInformation) == 0 {
		t.Fatal("expected missing information for unanswered logistics")
	}
	if !summary.Audit.GeneratedFromCompletedSession {
		t.Fatal("expected audit to mark completed session")
	}
	if len(summary.Audit.SourceEventIDs) != len(events) {
		t.Fatalf("expected %d source event ids, got %d", len(events), len(summary.Audit.SourceEventIDs))
	}
}

func TestServiceRecruiterSummaryExcludesSensitiveCandidateSignals(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 45, 0, 0, time.UTC)}
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
		eventInput(session.Session.ID, 2, "evt_q1", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 3, "evt_turn_sensitive", domain.EventCandidateTurnFinalized),
	}
	events[1].Payload = validQuestionAskedPayload(session.Session.ID, "q1", 0)
	events[2].Actor = domain.EventActorCandidate
	events[2].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_sensitive",
		"J'ai 54 ans et je peux aussi parler de mon experience produit avec les clients B2B.",
	)

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.Type, err)
		}
	}

	summary, err := service.GetRecruiterSummary(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetRecruiterSummary returned error: %v", err)
	}

	if summary.Recommendation.Value != "insufficient_evidence" {
		t.Fatalf("expected insufficient evidence, got %s", summary.Recommendation.Value)
	}
	if len(summary.ExcludedSensitiveSignals) != 1 || summary.ExcludedSensitiveSignals[0] != "age" {
		t.Fatalf("expected age exclusion, got %#v", summary.ExcludedSensitiveSignals)
	}
	if !stringSliceContains(summary.ComplianceFlags, "sensitive_signal_review_required") {
		t.Fatalf("expected sensitive_signal_review_required flag, got %#v", summary.ComplianceFlags)
	}
	for _, criterion := range summary.Criteria {
		for _, evidence := range criterion.Evidence {
			if strings.Contains(evidence.Quote, "54 ans") {
				t.Fatalf("sensitive quote leaked into evidence: %#v", evidence)
			}
		}
	}
}

func TestServiceRecruiterSummaryUsesEvaluationMatrixRiskExplanation(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 45, 0, 0, time.UTC)}
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
		eventInput(session.Session.ID, 2, "evt_q1", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 3, "evt_turn_q1", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 4, "evt_eval_q1", domain.EventAnswerEvaluated),
	}
	events[1].Payload = validQuestionAskedPayload(session.Session.ID, "q1", 0)
	events[2].Actor = domain.EventActorCandidate
	events[2].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_q1",
		"caca",
	)
	events[3].Actor = domain.EventActorSystem
	events[3].Payload = validMatrixAnswerEvaluatedPayload("q1", "turn_q1")

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.Type, err)
		}
	}

	summary, err := service.GetRecruiterSummary(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetRecruiterSummary returned error: %v", err)
	}

	if summary.Criteria[0].Status != "unclear" {
		t.Fatalf("expected unclear first criterion, got %s", summary.Criteria[0].Status)
	}
	if len(summary.Risks) == 0 {
		t.Fatal("expected matrix-backed risk")
	}
	if !strings.Contains(summary.Risks[0].Explanation, "coherence") {
		t.Fatalf("expected matrix risk explanation, got %s", summary.Risks[0].Explanation)
	}
	if !strings.Contains(summary.Criteria[0].Note, "incoherent or absurd answer") {
		t.Fatalf("expected matrix challenge note, got %s", summary.Criteria[0].Note)
	}
}

func TestServiceRecruiterSummaryPrefersMatrixOverAnswerLength(t *testing.T) {
	clock := fixedClock{now: time.Date(2026, 6, 17, 10, 45, 0, 0, time.UTC)}
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
		eventInput(session.Session.ID, 2, "evt_q1", domain.EventQuestionAsked),
		eventInput(session.Session.ID, 3, "evt_turn_q1", domain.EventCandidateTurnFinalized),
		eventInput(session.Session.ID, 4, "evt_eval_q1", domain.EventAnswerEvaluated),
	}
	events[1].Payload = validQuestionAskedPayload(session.Session.ID, "q1", 0)
	events[2].Actor = domain.EventActorCandidate
	events[2].Payload = validCandidateTurnFinalizedPayload(
		session.Session.ID,
		"q1",
		"turn_q1",
		"Oui, j'ai mene ce projet.",
	)
	events[3].Actor = domain.EventActorSystem
	events[3].Payload = validStrongMatrixAnswerEvaluatedPayload("q1", "turn_q1")

	for _, event := range events {
		if _, err := service.IngestEvent(context.Background(), event); err != nil {
			t.Fatalf("IngestEvent(%s) returned error: %v", event.Type, err)
		}
	}

	summary, err := service.GetRecruiterSummary(context.Background(), session.Session.ID)
	if err != nil {
		t.Fatalf("GetRecruiterSummary returned error: %v", err)
	}

	if summary.Criteria[0].Status != "satisfied" {
		t.Fatalf("expected matrix-backed satisfied criterion, got %s", summary.Criteria[0].Status)
	}
}

func stringSliceContains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
