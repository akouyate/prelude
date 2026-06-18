package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

var (
	ErrInvalidInput     = errors.New("invalid input")
	ErrInvalidEvent     = errors.New("invalid event")
	ErrSessionNotFound  = errors.New("session not found")
	ErrEventConflict    = errors.New("event id already exists with different content")
	ErrRepositoryFailed = errors.New("repository failed")
)

type Clock interface {
	Now() time.Time
}

type SystemClock struct{}

func (SystemClock) Now() time.Time {
	return time.Now().UTC()
}

type SessionRepository interface {
	CreateSession(ctx context.Context, session domain.Session) error
	GetSession(ctx context.Context, sessionID string) (domain.Session, error)
	AppendEvent(ctx context.Context, event domain.Event) (AppendEventResult, error)
}

type AppendEventResult struct {
	Event     domain.Event
	Duplicate bool
}

type LiveKitGateway interface {
	CreateJoin(ctx context.Context, input LiveKitJoinInput) (LiveKitJoin, error)
}

type LiveKitJoinInput struct {
	SessionID   string
	RoomName    string
	Participant string
}

type LiveKitJoin struct {
	RoomName    string    `json:"room_name"`
	URL         string    `json:"url"`
	Token       string    `json:"token"`
	Participant string    `json:"participant"`
	ExpiresAt   time.Time `json:"expires_at"`
}

type Service struct {
	repository SessionRepository
	livekit    LiveKitGateway
	clock      Clock
}

func NewService(repository SessionRepository, livekit LiveKitGateway, clock Clock) *Service {
	if clock == nil {
		clock = SystemClock{}
	}

	return &Service{
		repository: repository,
		livekit:    livekit,
		clock:      clock,
	}
}

type CreateSessionInput struct {
	InterviewPlanID   string
	CandidateID       string
	AllowedModalities []domain.Modality
}

type CreateSessionOutput struct {
	Session domain.Session `json:"session"`
	Join    LiveKitJoin    `json:"livekit_join"`
}

type InterviewPlan struct {
	ID                      string              `json:"id"`
	RoleTitle               string              `json:"role_title"`
	Language                string              `json:"language"`
	Questions               []InterviewQuestion `json:"questions"`
	AllowVideo              bool                `json:"allow_video"`
	AllowAudioOnly          bool                `json:"allow_audio_only"`
	MaxFollowupsPerQuestion int                 `json:"max_followups_per_question"`
	InterviewStyle          InterviewStyle      `json:"interview_style"`
}

type InterviewQuestion struct {
	ID             string `json:"id"`
	Prompt         string `json:"prompt"`
	Category       string `json:"category"`
	FollowUpPrompt string `json:"follow_up_prompt,omitempty"`
}

type InterviewStyle struct {
	Sector          string   `json:"sector,omitempty"`
	Seniority       string   `json:"seniority,omitempty"`
	WorkEnvironment string   `json:"work_environment,omitempty"`
	RoleConstraints []string `json:"role_constraints,omitempty"`
	CompanyContext  string   `json:"company_context,omitempty"`
	CandidateTone   string   `json:"candidate_tone,omitempty"`
}

type AgentConfigOutput struct {
	Session       domain.Session `json:"session"`
	LiveKitJoin   LiveKitJoin    `json:"livekit_join"`
	InterviewPlan InterviewPlan  `json:"interview_plan"`
	Provider      string         `json:"provider"`
}

func (s *Service) CreateSession(ctx context.Context, input CreateSessionInput) (CreateSessionOutput, error) {
	if strings.TrimSpace(input.InterviewPlanID) == "" {
		return CreateSessionOutput{}, fmt.Errorf("%w: interview_plan_id is required", ErrInvalidInput)
	}
	if strings.TrimSpace(input.CandidateID) == "" {
		return CreateSessionOutput{}, fmt.Errorf("%w: candidate_id is required", ErrInvalidInput)
	}

	modalities, err := normalizeModalities(input.AllowedModalities)
	if err != nil {
		return CreateSessionOutput{}, err
	}
	sessionID := newID("is")
	now := s.clock.Now()
	roomName := "prelude-" + sessionID

	session := domain.Session{
		ID:                sessionID,
		InterviewPlanID:   input.InterviewPlanID,
		CandidateID:       input.CandidateID,
		Status:            domain.SessionStatusWaitingCandidate,
		LiveKitRoomName:   roomName,
		AllowedModalities: modalities,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	if err := s.repository.CreateSession(ctx, session); err != nil {
		return CreateSessionOutput{}, fmt.Errorf("%w: %v", ErrRepositoryFailed, err)
	}

	join, err := s.livekit.CreateJoin(ctx, LiveKitJoinInput{
		SessionID:   session.ID,
		RoomName:    session.LiveKitRoomName,
		Participant: "candidate-" + session.CandidateID,
	})
	if err != nil {
		return CreateSessionOutput{}, err
	}

	return CreateSessionOutput{Session: session, Join: join}, nil
}

func (s *Service) GetSession(ctx context.Context, sessionID string) (domain.Session, error) {
	if strings.TrimSpace(sessionID) == "" {
		return domain.Session{}, fmt.Errorf("%w: session_id is required", ErrInvalidInput)
	}

	session, err := s.repository.GetSession(ctx, sessionID)
	if err != nil {
		return domain.Session{}, err
	}

	return session, nil
}

func (s *Service) GetAgentConfig(ctx context.Context, sessionID string) (AgentConfigOutput, error) {
	session, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return AgentConfigOutput{}, err
	}

	join, err := s.livekit.CreateJoin(ctx, LiveKitJoinInput{
		SessionID:   session.ID,
		RoomName:    session.LiveKitRoomName,
		Participant: "agent-" + session.ID,
	})
	if err != nil {
		return AgentConfigOutput{}, err
	}

	return AgentConfigOutput{
		Session:       session,
		LiveKitJoin:   join,
		InterviewPlan: demoInterviewPlan(session.InterviewPlanID),
		Provider:      "mock",
	}, nil
}

type IngestEventInput struct {
	SessionID        string
	CandidateID      string
	EventID          string
	Type             domain.EventType
	Actor            domain.EventActor
	Sequence         int
	IdempotencyKey   string
	OccurredAt       time.Time
	Payload          json.RawMessage
	ProviderMetadata json.RawMessage
}

type IngestEventOutput struct {
	Event     domain.Event `json:"event"`
	Duplicate bool         `json:"duplicate"`
}

func (s *Service) IngestEvent(ctx context.Context, input IngestEventInput) (IngestEventOutput, error) {
	if strings.TrimSpace(input.SessionID) == "" {
		return IngestEventOutput{}, fmt.Errorf("%w: session_id is required", ErrInvalidInput)
	}
	if strings.TrimSpace(input.EventID) == "" {
		return IngestEventOutput{}, fmt.Errorf("%w: event_id is required", ErrInvalidInput)
	}
	if input.Sequence < 1 {
		return IngestEventOutput{}, fmt.Errorf("%w: sequence must be greater than zero", ErrInvalidInput)
	}
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		return IngestEventOutput{}, fmt.Errorf("%w: idempotency_key is required", ErrInvalidInput)
	}
	if strings.TrimSpace(string(input.Type)) == "" {
		return IngestEventOutput{}, fmt.Errorf("%w: type is required", ErrInvalidInput)
	}
	if !knownEventType(input.Type) {
		return IngestEventOutput{}, fmt.Errorf("%w: unsupported event type %q", ErrInvalidEvent, input.Type)
	}
	if strings.TrimSpace(string(input.Actor)) == "" {
		return IngestEventOutput{}, fmt.Errorf("%w: actor is required", ErrInvalidInput)
	}
	if !knownEventActor(input.Actor) {
		return IngestEventOutput{}, fmt.Errorf("%w: unsupported actor %q", ErrInvalidInput, input.Actor)
	}
	if len(input.Payload) == 0 {
		input.Payload = json.RawMessage(`{}`)
	}
	if !json.Valid(input.Payload) {
		return IngestEventOutput{}, fmt.Errorf("%w: payload must be valid json", ErrInvalidInput)
	}
	if len(input.ProviderMetadata) > 0 && !json.Valid(input.ProviderMetadata) {
		return IngestEventOutput{}, fmt.Errorf("%w: provider_metadata must be valid json", ErrInvalidInput)
	}
	if input.OccurredAt.IsZero() {
		input.OccurredAt = s.clock.Now()
	}

	event := domain.Event{
		ID:               input.EventID,
		SessionID:        input.SessionID,
		CandidateID:      strings.TrimSpace(input.CandidateID),
		Type:             input.Type,
		Actor:            input.Actor,
		Sequence:         input.Sequence,
		IdempotencyKey:   input.IdempotencyKey,
		OccurredAt:       input.OccurredAt.UTC(),
		Payload:          input.Payload,
		ProviderMetadata: input.ProviderMetadata,
	}

	result, err := s.repository.AppendEvent(ctx, event)
	if err != nil {
		return IngestEventOutput{}, err
	}

	return IngestEventOutput{Event: result.Event, Duplicate: result.Duplicate}, nil
}

func (s *Service) GetTranscript(ctx context.Context, sessionID string) ([]domain.TranscriptTurn, error) {
	session, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	turns := make([]domain.TranscriptTurn, 0)
	for _, event := range session.Events {
		turn, ok := transcriptTurnFromEvent(event)
		if !ok {
			continue
		}
		turns = append(turns, turn)
	}

	return turns, nil
}

func knownEventActor(actor domain.EventActor) bool {
	switch actor {
	case domain.EventActorAgent, domain.EventActorCandidate, domain.EventActorSystem:
		return true
	default:
		return false
	}
}

type transcriptPayload struct {
	TranscriptTurn      *transcriptTurnPayload `json:"transcript_turn"`
	TranscriptTurnCamel *transcriptTurnPayload `json:"transcriptTurn"`
}

type transcriptTurnPayload struct {
	TurnID          string   `json:"turn_id"`
	TurnIDCamel     string   `json:"turnId"`
	SessionID       string   `json:"session_id"`
	SessionIDCamel  string   `json:"sessionId"`
	QuestionID      string   `json:"question_id"`
	QuestionIDCamel string   `json:"questionId"`
	Speaker         string   `json:"speaker"`
	Text            string   `json:"text"`
	IsFinal         *bool    `json:"is_final"`
	IsFinalCamel    *bool    `json:"isFinal"`
	StartedAt       string   `json:"started_at"`
	StartedAtCamel  string   `json:"startedAt"`
	EndedAt         string   `json:"ended_at"`
	EndedAtCamel    string   `json:"endedAt"`
	Confidence      *float64 `json:"confidence"`
}

func transcriptTurnFromEvent(event domain.Event) (domain.TranscriptTurn, bool) {
	var payload transcriptPayload
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return domain.TranscriptTurn{}, false
	}

	raw := payload.TranscriptTurn
	if raw == nil {
		raw = payload.TranscriptTurnCamel
	}
	if raw == nil {
		return domain.TranscriptTurn{}, false
	}

	startedAt := event.OccurredAt
	if value := firstNonEmpty(raw.StartedAt, raw.StartedAtCamel); value != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			startedAt = parsed.UTC()
		}
	}

	var endedAt *time.Time
	if value := firstNonEmpty(raw.EndedAt, raw.EndedAtCamel); value != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			normalized := parsed.UTC()
			endedAt = &normalized
		}
	}

	isFinal := true
	if raw.IsFinal != nil {
		isFinal = *raw.IsFinal
	}
	if raw.IsFinalCamel != nil {
		isFinal = *raw.IsFinalCamel
	}

	speaker := domain.TranscriptSpeaker(raw.Speaker)
	if speaker == "" {
		speaker = domain.TranscriptSpeakerCandidate
	}

	return domain.TranscriptTurn{
		TurnID:     firstNonEmpty(raw.TurnID, raw.TurnIDCamel, event.ID),
		SessionID:  firstNonEmpty(raw.SessionID, raw.SessionIDCamel, event.SessionID),
		QuestionID: firstNonEmpty(raw.QuestionID, raw.QuestionIDCamel),
		Speaker:    speaker,
		Text:       strings.TrimSpace(raw.Text),
		IsFinal:    isFinal,
		StartedAt:  startedAt,
		EndedAt:    endedAt,
		Confidence: raw.Confidence,
	}, strings.TrimSpace(raw.Text) != ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}

func knownEventType(eventType domain.EventType) bool {
	switch eventType {
	case domain.EventSessionStarted,
		domain.EventCandidateJoined,
		domain.EventAgentJoined,
		domain.EventAgentSpeechStarted,
		domain.EventAgentSpeechCompleted,
		domain.EventAgentSpeechInterrupted,
		domain.EventQuestionAsked,
		domain.EventQuestionRepeated,
		domain.EventCandidateSpeechStarted,
		domain.EventCandidateSpeechStopped,
		domain.EventCandidateTurnDetected,
		domain.EventCandidateTurnStarted,
		domain.EventCandidateTurnFinalized,
		domain.EventBargeInDetected,
		domain.EventBargeInAccepted,
		domain.EventBargeInRejected,
		domain.EventBackchannelDetected,
		domain.EventSilenceTimeoutStarted,
		domain.EventWaitRequested,
		domain.EventSoftReprompted,
		domain.EventFollowupAsked,
		domain.EventQuestionCompleted,
		domain.EventSessionClosing,
		domain.EventSessionCompleted,
		domain.EventSessionFailed:
		return true
	default:
		return false
	}
}

func demoInterviewPlan(planID string) InterviewPlan {
	if strings.TrimSpace(planID) == "" {
		planID = "plan-demo-product-manager"
	}

	return InterviewPlan{
		ID:                      planID,
		RoleTitle:               "Product Manager B2B SaaS",
		Language:                "fr",
		AllowVideo:              true,
		AllowAudioOnly:          true,
		MaxFollowupsPerQuestion: 1,
		InterviewStyle: InterviewStyle{
			Sector:          "B2B SaaS",
			Seniority:       "mid to senior",
			WorkEnvironment: "office or hybrid customer-facing product work",
			RoleConstraints: []string{
				"coordinate with product and customer-facing teams",
				"handle roadmap trade-offs under customer pressure",
				"communicate clearly with SMB stakeholders",
			},
			CompanyContext: "Prelude is screening candidates for a structured first interview before recruiter review.",
			CandidateTone:  "professional, concise, and concrete",
		},
		Questions: []InterviewQuestion{
			{
				ID:             "q1",
				Prompt:         "Bonjour, pouvez-vous vous presenter brievement et expliquer ce qui vous interesse dans ce poste ?",
				Category:       "motivation",
				FollowUpPrompt: "Qu'est-ce qui vous attire le plus dans ce contexte produit ?",
			},
			{
				ID:             "q2",
				Prompt:         "Parlez-moi d'une experience ou vous avez du prioriser une roadmap avec des contraintes fortes.",
				Category:       "experience",
				FollowUpPrompt: "Quel compromis avez-vous fait et comment l'avez-vous explique aux parties prenantes ?",
			},
			{
				ID:       "q3",
				Prompt:   "Quelles sont vos disponibilites et vos contraintes eventuelles pour la suite du process ?",
				Category: "logistics",
			},
		},
	}
}

func normalizeModalities(modalities []domain.Modality) ([]domain.Modality, error) {
	if len(modalities) == 0 {
		return []domain.Modality{domain.ModalityAudio}, nil
	}

	seen := map[domain.Modality]bool{}
	normalized := make([]domain.Modality, 0, len(modalities))
	for _, modality := range modalities {
		if modality == "" {
			continue
		}
		if !knownModality(modality) {
			return nil, fmt.Errorf("%w: unsupported modality %q", ErrInvalidInput, modality)
		}
		if seen[modality] {
			continue
		}
		seen[modality] = true
		normalized = append(normalized, modality)
	}
	if len(normalized) == 0 {
		return []domain.Modality{domain.ModalityAudio}, nil
	}

	return normalized, nil
}

func knownModality(modality domain.Modality) bool {
	switch modality {
	case domain.ModalityForm, domain.ModalityAudio, domain.ModalityVideo:
		return true
	default:
		return false
	}
}

func newID(prefix string) string {
	var bytes [12]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}

	return prefix + "_" + hex.EncodeToString(bytes[:])
}
