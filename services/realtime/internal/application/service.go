package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

var (
	ErrInvalidInput     = errors.New("invalid input")
	ErrInvalidEvent     = errors.New("invalid event")
	ErrSessionNotFound  = errors.New("session not found")
	ErrPlanNotFound     = errors.New("interview plan not found")
	ErrEventConflict    = errors.New("event id already exists with different content")
	ErrRepositoryFailed = errors.New("repository failed")
)

const (
	liveKitRoomEmptyTimeout    = 5 * time.Minute
	liveKitRoomMaxParticipants = 2
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

type InterviewPlanRepository interface {
	GetInterviewPlan(ctx context.Context, planID string) (InterviewPlan, error)
}

type AppendEventResult struct {
	Event     domain.Event
	Duplicate bool
}

type AgentDispatchQueue interface {
	EnqueueAgentJoin(ctx context.Context, request AgentJoinRequest) (AgentJoinDispatchResult, error)
}

type AgentJoinRequest struct {
	SessionID   string
	CandidateID string
	RequestedAt time.Time
}

type AgentJoinDispatchResult struct {
	Enqueued bool
}

type LiveKitGateway interface {
	// EnsureRoom idempotently pre-provisions the room so it exists with controlled
	// options before either participant is handed a join token. It is best-effort
	// at the call site (LiveKit auto-creates on join as a fallback).
	EnsureRoom(ctx context.Context, input EnsureRoomInput) error
	CreateJoin(ctx context.Context, input LiveKitJoinInput) (LiveKitJoin, error)
}

type EnsureRoomInput struct {
	RoomName        string
	EmptyTimeout    time.Duration
	MaxParticipants uint32
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

// RecordingRepository persists live-interview audio-recording state. It is a
// deliberately separate contract from SessionRepository: the session row is
// event-derived (mutated only as an AppendEvent side-effect), whereas recording
// state is a mutable row keyed by EgressID that the egress_ended webhook
// finalizes out-of-band, after the session is already terminal.
type RecordingRepository interface {
	// CreateRecording inserts a new recording row (typically status "recording"
	// at egress start, or "failed" when a start attempt never returned an id).
	CreateRecording(ctx context.Context, recording domain.Recording) error
	// FinalizeRecordingByEgressID transitions the single in-flight recording for
	// the egress id to its terminal state. It only matches rows still in
	// "recording" status, so redelivered webhooks are a no-op (updated=false).
	FinalizeRecordingByEgressID(ctx context.Context, input FinalizeRecordingInput) (bool, error)
	// ActiveRecordingForSession returns the in-flight ("recording") recording for
	// a session, if any. It is the start guard ("is an egress already active?")
	// and the source of the egress id used to stop on session completion.
	ActiveRecordingForSession(ctx context.Context, sessionID string) (domain.Recording, bool, error)
}

type FinalizeRecordingInput struct {
	EgressID   string
	Status     domain.RecordingStatus
	DurationMs *int
	EndedAt    time.Time
	UpdatedAt  time.Time
}

// EgressGateway starts and stops LiveKit room-composite egress jobs that record
// the interview audio into object storage. It is optional: when recording is
// disabled the service never receives one and no audio is captured.
type EgressGateway interface {
	StartRoomCompositeEgress(ctx context.Context, input StartEgressInput) (EgressHandle, error)
	StopEgress(ctx context.Context, egressID string) error
}

type StartEgressInput struct {
	RoomName  string
	ObjectKey string
	Format    string
}

type EgressHandle struct {
	EgressID string
}

// RecordingConsentGate reports whether the candidate behind a live session has
// recorded their consent to be recorded. Recording is fail-closed: without a
// positive consent signal, no egress is started.
type RecordingConsentGate interface {
	RecordingConsentGranted(ctx context.Context, sessionID string) (bool, error)
}

const recordingAudioFormat = "audio/ogg"

type Service struct {
	repository     SessionRepository
	planRepository InterviewPlanRepository
	agentQueue     AgentDispatchQueue
	livekit        LiveKitGateway
	recorder       EgressGateway
	recordings     RecordingRepository
	consent        RecordingConsentGate
	clock          Clock
	provider       string
}

func NewService(repository SessionRepository, livekit LiveKitGateway, clock Clock) *Service {
	if clock == nil {
		clock = SystemClock{}
	}

	service := &Service{
		repository: repository,
		livekit:    livekit,
		clock:      clock,
	}
	if planRepository, ok := repository.(InterviewPlanRepository); ok {
		service.planRepository = planRepository
	}

	return service
}

func (s *Service) SetAgentDispatchQueue(queue AgentDispatchQueue) {
	s.agentQueue = queue
}

// SetEgressGateway, SetRecordingRepository, and SetRecordingConsentGate wire the
// optional audio-recording subsystem. All three must be set for recording to
// run; otherwise startRecordingIfNeeded is a no-op and no audio is captured.
func (s *Service) SetEgressGateway(gateway EgressGateway) {
	s.recorder = gateway
}

func (s *Service) SetRecordingRepository(repository RecordingRepository) {
	s.recordings = repository
}

func (s *Service) SetRecordingConsentGate(gate RecordingConsentGate) {
	s.consent = gate
}

// SetProvider configures the live voice provider reported to the agent worker.
// It must be a valid liveInterviewProviderSchema member; defaults to "mock".
func (s *Service) SetProvider(provider string) {
	s.provider = strings.TrimSpace(provider)
}

func (s *Service) providerName() string {
	if s.provider == "" {
		return "mock"
	}

	return s.provider
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
	ExpectedSignal string `json:"expected_signal,omitempty"`
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
	roomName := liveKitRoomName(sessionID)

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

	// #95: pre-provision the LiveKit room with controlled options BEFORE handing
	// out join tokens. Best-effort/non-fatal and idempotent — LiveKit auto-creates
	// on join as a fallback, so a transient gateway error must not stop the
	// candidate from receiving a token.
	if err := s.livekit.EnsureRoom(ctx, EnsureRoomInput{
		RoomName:        session.LiveKitRoomName,
		EmptyTimeout:    liveKitRoomEmptyTimeout,
		MaxParticipants: liveKitRoomMaxParticipants,
	}); err != nil {
		slog.Warn("failed to ensure livekit room", "session_id", session.ID, "room", session.LiveKitRoomName, "error", err)
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

	plan, provider, err := s.resolveInterviewPlan(ctx, session.InterviewPlanID)
	if err != nil {
		return AgentConfigOutput{}, err
	}

	return AgentConfigOutput{
		Session:       session,
		LiveKitJoin:   join,
		InterviewPlan: plan,
		Provider:      provider,
	}, nil
}

func (s *Service) resolveInterviewPlan(ctx context.Context, planID string) (InterviewPlan, string, error) {
	planID = strings.TrimSpace(planID)
	if planID == "" || strings.HasPrefix(planID, "plan-demo-") || s.planRepository == nil {
		return demoInterviewPlan(planID), "mock", nil
	}

	plan, err := s.planRepository.GetInterviewPlan(ctx, planID)
	if err != nil {
		return InterviewPlan{}, "", err
	}

	return plan, s.providerName(), nil
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
	if secretKey, ok := secretKeyInJSON(input.Payload); ok {
		return IngestEventOutput{}, fmt.Errorf("%w: payload contains forbidden sensitive key %q", ErrInvalidEvent, secretKey)
	}
	if secretKey, ok := secretKeyInJSON(input.ProviderMetadata); ok {
		return IngestEventOutput{}, fmt.Errorf("%w: provider_metadata contains forbidden sensitive key %q", ErrInvalidEvent, secretKey)
	}
	if err := validateEventPayload(input.Type, input.Payload); err != nil {
		return IngestEventOutput{}, err
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

	if !result.Duplicate {
		s.dispatchAgentIfNeeded(ctx, result.Event)
		s.startRecordingIfNeeded(ctx, result.Event)
		s.stopRecordingIfNeeded(ctx, result.Event)
	}

	return IngestEventOutput{Event: result.Event, Duplicate: result.Duplicate}, nil
}

func (s *Service) dispatchAgentIfNeeded(ctx context.Context, event domain.Event) {
	if s.agentQueue == nil || event.Type != domain.EventCandidateMediaReady {
		return
	}

	_, err := s.agentQueue.EnqueueAgentJoin(ctx, AgentJoinRequest{
		SessionID:   event.SessionID,
		CandidateID: event.CandidateID,
		RequestedAt: s.clock.Now(),
	})
	if err != nil {
		slog.Warn("failed to dispatch live agent", "session_id", event.SessionID, "error", err)
	}
}

// startRecordingIfNeeded best-effort starts a LiveKit room-composite egress when
// the candidate's audio becomes ready, mirroring dispatchAgentIfNeeded: it runs
// off the ingestion path and never fails it. Recording is gated on the optional
// subsystem being wired, recorded consent, audio actually being live, and no
// egress already running for the session — a reconnect re-enters the same room,
// so the guard is "is an egress active?", not "did this session ever record?".
func (s *Service) startRecordingIfNeeded(ctx context.Context, event domain.Event) {
	if s.recorder == nil || s.recordings == nil || s.consent == nil {
		return
	}
	if event.Type != domain.EventCandidateMediaReady {
		return
	}
	if !candidateAudioReady(event.Payload) {
		return
	}

	granted, err := s.consent.RecordingConsentGranted(ctx, event.SessionID)
	if err != nil {
		slog.Warn("failed to check recording consent", "session_id", event.SessionID, "error", err)
		return
	}
	if !granted {
		return
	}

	if _, active, err := s.recordings.ActiveRecordingForSession(ctx, event.SessionID); err != nil {
		slog.Warn("failed to check active recording", "session_id", event.SessionID, "error", err)
		return
	} else if active {
		return
	}

	now := s.clock.Now()
	objectKey := recordingObjectKey(event.SessionID, now)
	handle, err := s.recorder.StartRoomCompositeEgress(ctx, StartEgressInput{
		RoomName:  liveKitRoomName(event.SessionID),
		ObjectKey: objectKey,
		Format:    recordingAudioFormat,
	})
	if err != nil {
		slog.Warn("failed to start interview recording", "session_id", event.SessionID, "error", err)
		if createErr := s.recordings.CreateRecording(ctx, domain.Recording{
			ID:           newID("rec"),
			SessionID:    event.SessionID,
			ObjectKey:    objectKey,
			Status:       domain.RecordingStatusFailed,
			Format:       recordingAudioFormat,
			FailedReason: "egress_start_failed",
			StartedAt:    now,
			CreatedAt:    now,
			UpdatedAt:    now,
		}); createErr != nil {
			slog.Warn("failed to persist failed recording", "session_id", event.SessionID, "error", createErr)
		}
		return
	}

	if err := s.recordings.CreateRecording(ctx, domain.Recording{
		ID:        newID("rec"),
		SessionID: event.SessionID,
		EgressID:  handle.EgressID,
		ObjectKey: objectKey,
		Status:    domain.RecordingStatusRecording,
		Format:    recordingAudioFormat,
		StartedAt: now,
		CreatedAt: now,
		UpdatedAt: now,
	}); err != nil {
		slog.Warn("failed to persist recording", "session_id", event.SessionID, "egress_id", handle.EgressID, "error", err)
	}
}

// stopRecordingIfNeeded best-effort stops the active egress when the session ends
// so the audio object finalizes promptly instead of waiting for the room's empty
// timeout. LiveKit also auto-stops on room close, so a failure here is non-fatal.
func (s *Service) stopRecordingIfNeeded(ctx context.Context, event domain.Event) {
	if s.recorder == nil || s.recordings == nil {
		return
	}
	if event.Type != domain.EventSessionCompleted && event.Type != domain.EventSessionFailed {
		return
	}

	recording, active, err := s.recordings.ActiveRecordingForSession(ctx, event.SessionID)
	if err != nil {
		slog.Warn("failed to look up active recording", "session_id", event.SessionID, "error", err)
		return
	}
	if !active || recording.EgressID == "" {
		return
	}

	if err := s.recorder.StopEgress(ctx, recording.EgressID); err != nil {
		slog.Warn("failed to stop interview recording", "session_id", event.SessionID, "egress_id", recording.EgressID, "error", err)
	}
}

func candidateAudioReady(payload json.RawMessage) bool {
	var parsed struct {
		Audio bool `json:"audio"`
	}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return false
	}

	return parsed.Audio
}

func liveKitRoomName(sessionID string) string {
	return "prelude-" + sessionID
}

func recordingObjectKey(sessionID string, at time.Time) string {
	return fmt.Sprintf("recordings/%s/%d.ogg", sessionID, at.UnixMilli())
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
		domain.EventCandidateMediaReady,
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
		domain.EventAnswerEvaluated,
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

type eventPayloadObject map[string]json.RawMessage

func validateEventPayload(eventType domain.EventType, payload json.RawMessage) error {
	switch eventType {
	case domain.EventCandidateJoined:
		return validateCandidateJoinedPayload(eventType, payload)
	case domain.EventCandidateMediaReady:
		return validateCandidateMediaReadyPayload(eventType, payload)
	case domain.EventQuestionAsked:
		return validateQuestionAskedPayload(eventType, payload)
	case domain.EventQuestionRepeated:
		return validateQuestionRepeatedPayload(eventType, payload)
	case domain.EventCandidateTurnFinalized:
		return validateCandidateTurnFinalizedPayload(eventType, payload)
	case domain.EventAnswerEvaluated:
		return validateAnswerEvaluatedPayload(eventType, payload)
	case domain.EventBargeInDetected:
		return validateBargeInDetectedPayload(eventType, payload)
	case domain.EventBargeInAccepted:
		return validateBargeInAcceptedPayload(eventType, payload)
	case domain.EventAgentSpeechInterrupted:
		return validateAgentSpeechInterruptedPayload(eventType, payload)
	case domain.EventBargeInRejected, domain.EventBackchannelDetected:
		return validateRejectedInterruptionPayload(eventType, payload)
	case domain.EventSilenceTimeoutStarted:
		return validateSilenceTimeoutStartedPayload(eventType, payload)
	case domain.EventWaitRequested:
		return validateWaitRequestedPayload(eventType, payload)
	case domain.EventSoftReprompted:
		return validateSoftRepromptedPayload(eventType, payload)
	case domain.EventFollowupAsked:
		return validateFollowupAskedPayload(eventType, payload)
	case domain.EventQuestionCompleted:
		return validateQuestionCompletedPayload(eventType, payload)
	case domain.EventSessionClosing:
		return validateSessionClosingPayload(eventType, payload)
	case domain.EventSessionCompleted:
		return validateSessionCompletedPayload(eventType, payload)
	case domain.EventSessionFailed:
		return validateSessionFailedPayload(eventType, payload)
	default:
		return nil
	}
}

func validateCandidateJoinedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "candidate_participant_id", "candidate_participant_id", "candidateParticipantId"); err != nil {
		return err
	}
	modes, err := requireStringArrayField(object, eventType, "modes", 1, "modes")
	if err != nil {
		return err
	}
	for _, mode := range modes {
		if !knownModality(domain.Modality(mode)) {
			return fmt.Errorf("%w: unsupported candidate_joined mode %q", ErrInvalidEvent, mode)
		}
	}
	_, _, err = optionalStringField(object, eventType, "room_name", "room_name", "roomName")
	return err
}

func validateCandidateMediaReadyPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "candidate_participant_id", "candidate_participant_id", "candidateParticipantId"); err != nil {
		return err
	}
	audioReady, err := requireBoolField(object, eventType, "audio", "audio")
	if err != nil {
		return err
	}
	videoReady, err := requireBoolField(object, eventType, "video", "video")
	if err != nil {
		return err
	}
	tracks, err := requireStringArrayField(object, eventType, "published_tracks", 1, "published_tracks", "publishedTracks")
	if err != nil {
		return err
	}
	seenTracks := map[string]bool{}
	for _, track := range tracks {
		if !knownPublishedTrack(track) {
			return fmt.Errorf("%w: unsupported candidate_media_ready published track %q", ErrInvalidEvent, track)
		}
		seenTracks[track] = true
	}
	if audioReady && !seenTracks["microphone"] {
		return fmt.Errorf("%w: candidate_media_ready audio requires microphone track", ErrInvalidEvent)
	}
	if videoReady && !seenTracks["camera"] {
		return fmt.Errorf("%w: candidate_media_ready video requires camera track", ErrInvalidEvent)
	}
	_, _, err = optionalStringField(object, eventType, "room_name", "room_name", "roomName")
	return err
}

func validateQuestionAskedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireIntRangeField(object, eventType, "question_index", 0, 1000, "question_index", "questionIndex"); err != nil {
		return err
	}
	if _, err := requireTextField(object, eventType, "prompt", 8, 800, "prompt"); err != nil {
		return err
	}
	return validateOptionalTranscriptTurn(object, eventType, string(domain.TranscriptSpeakerInterviewer))
}

func validateQuestionRepeatedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireTextField(object, eventType, "prompt", 8, 800, "prompt"); err != nil {
		return err
	}
	if err := requireExactStringField(object, eventType, "reason", "candidate_requested_repeat", "reason"); err != nil {
		return err
	}
	return validateOptionalTranscriptTurn(object, eventType, string(domain.TranscriptSpeakerInterviewer))
}

func validateCandidateTurnFinalizedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	completionReason, err := requireStringField(object, eventType, "completion_reason", "completion_reason", "completionReason")
	if err != nil {
		return err
	}
	if !knownTurnCompletionReason(completionReason) {
		return fmt.Errorf("%w: unsupported completion reason %q", ErrInvalidEvent, completionReason)
	}
	return validateRequiredTranscriptTurn(object, eventType, string(domain.TranscriptSpeakerCandidate))
}

func validateAnswerEvaluatedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	turnIDs, err := requireStringArrayField(object, eventType, "turn_ids", 1, "turn_ids", "turnIds")
	if err != nil {
		return err
	}
	for _, turnID := range turnIDs {
		if strings.TrimSpace(turnID) == "" {
			return fmt.Errorf("%w: answer_evaluated turn_ids cannot contain empty values", ErrInvalidEvent)
		}
	}
	if _, err := requireIntRangeField(object, eventType, "attempt_index", 1, 1000, "attempt_index", "attemptIndex"); err != nil {
		return err
	}
	classification, err := requireStringField(object, eventType, "classification", "classification")
	if err != nil {
		return err
	}
	if !knownAnswerClassification(classification) {
		return fmt.Errorf("%w: unsupported answer classification %q", ErrInvalidEvent, classification)
	}
	if _, err := requireStringArrayField(object, eventType, "reason_codes", 0, "reason_codes", "reasonCodes"); err != nil {
		return err
	}
	policyAction, err := requireStringField(object, eventType, "policy_action", "policy_action", "policyAction")
	if err != nil {
		return err
	}
	if !knownPolicyAction(policyAction) {
		return fmt.Errorf("%w: unsupported policy action %q", ErrInvalidEvent, policyAction)
	}
	if _, err := requireFloatRangeField(object, eventType, "confidence", 0, 1, "confidence"); err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "evaluator_version", "evaluator_version", "evaluatorVersion"); err != nil {
		return err
	}
	return nil
}

func validateBargeInDetectedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "utterance_id", "utterance_id", "utteranceId"); err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, _, err := optionalIntRangeField(object, eventType, "overlap_ms", 0, 3600000, "overlap_ms", "overlapMs"); err != nil {
		return err
	}
	if _, _, err := optionalIntRangeField(object, eventType, "candidate_speech_ms", 0, 3600000, "candidate_speech_ms", "candidateSpeechMs"); err != nil {
		return err
	}
	_, _, err = optionalFloatRangeField(object, eventType, "confidence", 0, 1, "confidence")
	return err
}

func validateBargeInAcceptedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "utterance_id", "utterance_id", "utteranceId"); err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireIntRangeField(object, eventType, "cancel_latency_ms", 0, 3600000, "cancel_latency_ms", "cancelLatencyMs"); err != nil {
		return err
	}
	_, _, err = optionalIntRangeField(object, eventType, "truncated_at_ms", 0, 3600000, "truncated_at_ms", "truncatedAtMs")
	return err
}

func validateAgentSpeechInterruptedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "utterance_id", "utterance_id", "utteranceId"); err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireIntRangeField(object, eventType, "cancel_latency_ms", 0, 3600000, "cancel_latency_ms", "cancelLatencyMs"); err != nil {
		return err
	}
	if err := requireExactBoolField(object, eventType, "cancel_agent_audio", true, "cancel_agent_audio", "cancelAgentAudio"); err != nil {
		return err
	}
	_, _, err = optionalIntRangeField(object, eventType, "truncated_at_ms", 0, 3600000, "truncated_at_ms", "truncatedAtMs")
	return err
}

func validateRejectedInterruptionPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "utterance_id", "utterance_id", "utteranceId"); err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	reason, err := requireStringField(object, eventType, "reason", "reason")
	if err != nil {
		return err
	}
	if !knownRejectedInterruptionReason(reason) {
		return fmt.Errorf("%w: unsupported interruption rejection reason %q", ErrInvalidEvent, reason)
	}
	_, _, err = optionalIntRangeField(object, eventType, "observed_speech_ms", 0, 3600000, "observed_speech_ms", "observedSpeechMs")
	return err
}

func validateSilenceTimeoutStartedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireIntRangeField(object, eventType, "threshold_ms", 1, 3600000, "threshold_ms", "thresholdMs"); err != nil {
		return err
	}
	if _, _, err := optionalIntRangeField(object, eventType, "silent_for_ms", 0, 3600000, "silent_for_ms", "silentForMs"); err != nil {
		return err
	}
	tier, err := requireStringField(object, eventType, "tier", "tier")
	if err != nil {
		return err
	}
	if !knownSilenceTier(tier) {
		return fmt.Errorf("%w: unsupported silence tier %q", ErrInvalidEvent, tier)
	}
	return nil
}

func validateWaitRequestedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if err := requireExactStringField(object, eventType, "reason", "candidate_requested_time", "reason"); err != nil {
		return err
	}
	if _, _, err := optionalRFC3339StringField(object, eventType, "requested_at", "requested_at", "requestedAt"); err != nil {
		return err
	}
	_, _, err = optionalRFC3339StringField(object, eventType, "wait_until", "wait_until", "waitUntil")
	return err
}

func validateSoftRepromptedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireTextField(object, eventType, "prompt", 8, 800, "prompt"); err != nil {
		return err
	}
	if _, err := requireIntRangeField(object, eventType, "reprompts_used", 1, 1, "reprompts_used", "repromptsUsed"); err != nil {
		return err
	}
	if _, _, err := optionalIntRangeField(object, eventType, "attempt_index", 1, 1000, "attempt_index", "attemptIndex"); err != nil {
		return err
	}
	return validateOptionalTranscriptTurn(object, eventType, string(domain.TranscriptSpeakerInterviewer))
}

func validateFollowupAskedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "followup_id", "followup_id", "followupId"); err != nil {
		return err
	}
	if _, err := requireTextField(object, eventType, "prompt", 8, 800, "prompt"); err != nil {
		return err
	}
	if _, err := requireIntRangeField(object, eventType, "followups_used", 1, 1, "followups_used", "followupsUsed"); err != nil {
		return err
	}
	if _, _, err := optionalIntRangeField(object, eventType, "attempt_index", 1, 1000, "attempt_index", "attemptIndex"); err != nil {
		return err
	}
	return validateOptionalTranscriptTurn(object, eventType, string(domain.TranscriptSpeakerInterviewer))
}

func validateQuestionCompletedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "question_id", "question_id", "questionId"); err != nil {
		return err
	}
	completionReason, err := requireStringField(object, eventType, "completion_reason", "completion_reason", "completionReason")
	if err != nil {
		return err
	}
	if !knownQuestionCompletionReason(completionReason) {
		return fmt.Errorf("%w: unsupported question completion reason %q", ErrInvalidEvent, completionReason)
	}
	_, _, err = optionalIntRangeField(object, eventType, "attempt_index", 1, 1000, "attempt_index", "attemptIndex")
	return err
}

func validateSessionClosingPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	completed, total, err := validateTerminalCounters(object, eventType)
	if err != nil {
		return err
	}
	if completed > total {
		return fmt.Errorf("%w: session_closing completed_questions cannot exceed total_questions", ErrInvalidEvent)
	}
	if _, err := requireTextField(object, eventType, "closing", 1, 800, "closing"); err != nil {
		return err
	}
	return validateOptionalTranscriptTurn(object, eventType, string(domain.TranscriptSpeakerInterviewer))
}

func validateSessionCompletedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	completedReason, err := requireStringField(object, eventType, "completed_reason", "completed_reason", "completedReason")
	if err != nil {
		return err
	}
	if !knownSessionCompletionReason(completedReason) {
		return fmt.Errorf("%w: unsupported session completion reason %q", ErrInvalidEvent, completedReason)
	}
	completed, total, err := validateTerminalCounters(object, eventType)
	if err != nil {
		return err
	}
	if completed > total {
		return fmt.Errorf("%w: session_completed completed_questions cannot exceed total_questions", ErrInvalidEvent)
	}
	return nil
}

func validateSessionFailedPayload(eventType domain.EventType, payload json.RawMessage) error {
	object, err := decodePayloadObject(eventType, payload)
	if err != nil {
		return err
	}
	if _, err := requireTextField(object, eventType, "code", 2, 80, "code"); err != nil {
		return err
	}
	if _, err := requireTextField(object, eventType, "message", 1, 500, "message"); err != nil {
		return err
	}
	_, err = requireBoolField(object, eventType, "retryable", "retryable")
	return err
}

func validateTerminalCounters(object eventPayloadObject, eventType domain.EventType) (int, int, error) {
	completed, err := requireIntRangeField(object, eventType, "completed_questions", 0, 1000, "completed_questions", "completedQuestions")
	if err != nil {
		return 0, 0, err
	}
	total, err := requireIntRangeField(object, eventType, "total_questions", 1, 1000, "total_questions", "totalQuestions")
	if err != nil {
		return 0, 0, err
	}
	return completed, total, nil
}

func validateOptionalTranscriptTurn(object eventPayloadObject, eventType domain.EventType, expectedSpeaker string) error {
	raw, _, ok := payloadField(object, "transcript_turn", "transcriptTurn")
	if !ok {
		return nil
	}
	return validateTranscriptTurnPayload(eventType, raw, expectedSpeaker)
}

func validateRequiredTranscriptTurn(object eventPayloadObject, eventType domain.EventType, expectedSpeaker string) error {
	raw, _, ok := payloadField(object, "transcript_turn", "transcriptTurn")
	if !ok {
		return fmt.Errorf("%w: %s requires transcript_turn", ErrInvalidEvent, eventType)
	}
	return validateTranscriptTurnPayload(eventType, raw, expectedSpeaker)
}

func validateTranscriptTurnPayload(eventType domain.EventType, payload json.RawMessage, expectedSpeaker string) error {
	object, err := decodeNamedPayloadObject("transcript_turn", payload)
	if err != nil {
		return fmt.Errorf("%w: %s %v", ErrInvalidEvent, eventType, err)
	}
	if _, err := requireStringField(object, eventType, "transcript_turn.turn_id", "turn_id", "turnId"); err != nil {
		return err
	}
	if _, err := requireStringField(object, eventType, "transcript_turn.session_id", "session_id", "sessionId"); err != nil {
		return err
	}
	if _, _, err := optionalStringField(object, eventType, "transcript_turn.question_id", "question_id", "questionId"); err != nil {
		return err
	}
	speaker, err := requireStringField(object, eventType, "transcript_turn.speaker", "speaker")
	if err != nil {
		return err
	}
	if !knownTranscriptSpeaker(speaker) {
		return fmt.Errorf("%w: unsupported transcript speaker %q", ErrInvalidEvent, speaker)
	}
	if expectedSpeaker != "" && speaker != expectedSpeaker {
		return fmt.Errorf("%w: %s transcript_turn speaker must be %q", ErrInvalidEvent, eventType, expectedSpeaker)
	}
	if _, err := requireTextField(object, eventType, "transcript_turn.text", 1, 12000, "text"); err != nil {
		return err
	}
	if _, _, err := optionalBoolField(object, eventType, "transcript_turn.is_final", "is_final", "isFinal"); err != nil {
		return err
	}
	if _, _, err := optionalFloatRangeField(object, eventType, "transcript_turn.confidence", 0, 1, "confidence"); err != nil {
		return err
	}
	if _, err := requireRFC3339StringField(object, eventType, "transcript_turn.started_at", "started_at", "startedAt"); err != nil {
		return err
	}
	_, _, err = optionalRFC3339StringField(object, eventType, "transcript_turn.ended_at", "ended_at", "endedAt")
	return err
}

func decodePayloadObject(eventType domain.EventType, payload json.RawMessage) (eventPayloadObject, error) {
	object, err := decodeNamedPayloadObject(string(eventType), payload)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidEvent, err)
	}
	return object, nil
}

func decodeNamedPayloadObject(name string, payload json.RawMessage) (eventPayloadObject, error) {
	var object eventPayloadObject
	if err := json.Unmarshal(payload, &object); err != nil {
		return nil, fmt.Errorf("%s payload must be an object", name)
	}
	if object == nil {
		return nil, fmt.Errorf("%s payload must be an object", name)
	}
	return object, nil
}

func payloadField(object eventPayloadObject, names ...string) (json.RawMessage, string, bool) {
	for _, name := range names {
		if raw, ok := object[name]; ok {
			return raw, name, true
		}
	}
	return nil, "", false
}

func requireStringField(object eventPayloadObject, eventType domain.EventType, label string, names ...string) (string, error) {
	value, ok, err := optionalStringField(object, eventType, label, names...)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("%w: %s requires %s", ErrInvalidEvent, eventType, label)
	}
	return value, nil
}

func optionalStringField(object eventPayloadObject, eventType domain.EventType, label string, names ...string) (string, bool, error) {
	raw, _, ok := payloadField(object, names...)
	if !ok {
		return "", false, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", true, fmt.Errorf("%w: %s %s must be a string", ErrInvalidEvent, eventType, label)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", true, fmt.Errorf("%w: %s %s cannot be empty", ErrInvalidEvent, eventType, label)
	}
	return value, true, nil
}

func requireTextField(object eventPayloadObject, eventType domain.EventType, label string, minLength int, maxLength int, names ...string) (string, error) {
	value, err := requireStringField(object, eventType, label, names...)
	if err != nil {
		return "", err
	}
	length := len([]rune(value))
	if length < minLength || length > maxLength {
		return "", fmt.Errorf("%w: %s %s must be between %d and %d characters", ErrInvalidEvent, eventType, label, minLength, maxLength)
	}
	return value, nil
}

func requireExactStringField(object eventPayloadObject, eventType domain.EventType, label string, expected string, names ...string) error {
	value, err := requireStringField(object, eventType, label, names...)
	if err != nil {
		return err
	}
	if value != expected {
		return fmt.Errorf("%w: %s %s must be %q", ErrInvalidEvent, eventType, label, expected)
	}
	return nil
}

func requireStringArrayField(object eventPayloadObject, eventType domain.EventType, label string, minLength int, names ...string) ([]string, error) {
	raw, _, ok := payloadField(object, names...)
	if !ok {
		return nil, fmt.Errorf("%w: %s requires %s", ErrInvalidEvent, eventType, label)
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, fmt.Errorf("%w: %s %s must be a string array", ErrInvalidEvent, eventType, label)
	}
	if values == nil {
		return nil, fmt.Errorf("%w: %s %s cannot be null", ErrInvalidEvent, eventType, label)
	}
	if len(values) < minLength {
		return nil, fmt.Errorf("%w: %s %s must contain at least %d value(s)", ErrInvalidEvent, eventType, label, minLength)
	}
	return values, nil
}

func requireIntRangeField(object eventPayloadObject, eventType domain.EventType, label string, minimum int, maximum int, names ...string) (int, error) {
	value, ok, err := optionalIntRangeField(object, eventType, label, minimum, maximum, names...)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, fmt.Errorf("%w: %s requires %s", ErrInvalidEvent, eventType, label)
	}
	return value, nil
}

func optionalIntRangeField(object eventPayloadObject, eventType domain.EventType, label string, minimum int, maximum int, names ...string) (int, bool, error) {
	raw, _, ok := payloadField(object, names...)
	if !ok {
		return 0, false, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, true, fmt.Errorf("%w: %s %s must be an integer", ErrInvalidEvent, eventType, label)
	}
	if value < minimum || value > maximum {
		return 0, true, fmt.Errorf("%w: %s %s must be between %d and %d", ErrInvalidEvent, eventType, label, minimum, maximum)
	}
	return value, true, nil
}

func requireFloatRangeField(object eventPayloadObject, eventType domain.EventType, label string, minimum float64, maximum float64, names ...string) (float64, error) {
	value, ok, err := optionalFloatRangeField(object, eventType, label, minimum, maximum, names...)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, fmt.Errorf("%w: %s requires %s", ErrInvalidEvent, eventType, label)
	}
	return value, nil
}

func optionalFloatRangeField(object eventPayloadObject, eventType domain.EventType, label string, minimum float64, maximum float64, names ...string) (float64, bool, error) {
	raw, _, ok := payloadField(object, names...)
	if !ok {
		return 0, false, nil
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, true, fmt.Errorf("%w: %s %s must be a number", ErrInvalidEvent, eventType, label)
	}
	if value < minimum || value > maximum {
		return 0, true, fmt.Errorf("%w: %s %s must be between %.2f and %.2f", ErrInvalidEvent, eventType, label, minimum, maximum)
	}
	return value, true, nil
}

func requireBoolField(object eventPayloadObject, eventType domain.EventType, label string, names ...string) (bool, error) {
	value, ok, err := optionalBoolField(object, eventType, label, names...)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, fmt.Errorf("%w: %s requires %s", ErrInvalidEvent, eventType, label)
	}
	return value, nil
}

func optionalBoolField(object eventPayloadObject, eventType domain.EventType, label string, names ...string) (bool, bool, error) {
	raw, _, ok := payloadField(object, names...)
	if !ok {
		return false, false, nil
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, true, fmt.Errorf("%w: %s %s must be a boolean", ErrInvalidEvent, eventType, label)
	}
	return value, true, nil
}

func requireExactBoolField(object eventPayloadObject, eventType domain.EventType, label string, expected bool, names ...string) error {
	value, err := requireBoolField(object, eventType, label, names...)
	if err != nil {
		return err
	}
	if value != expected {
		return fmt.Errorf("%w: %s %s must be %t", ErrInvalidEvent, eventType, label, expected)
	}
	return nil
}

func requireRFC3339StringField(object eventPayloadObject, eventType domain.EventType, label string, names ...string) (time.Time, error) {
	value, err := requireStringField(object, eventType, label, names...)
	if err != nil {
		return time.Time{}, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %s %s must be RFC3339", ErrInvalidEvent, eventType, label)
	}
	return parsed, nil
}

func optionalRFC3339StringField(object eventPayloadObject, eventType domain.EventType, label string, names ...string) (time.Time, bool, error) {
	value, ok, err := optionalStringField(object, eventType, label, names...)
	if err != nil || !ok {
		return time.Time{}, ok, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, true, fmt.Errorf("%w: %s %s must be RFC3339", ErrInvalidEvent, eventType, label)
	}
	return parsed, true, nil
}

func knownAnswerClassification(classification string) bool {
	switch classification {
	case "complete",
		"vague",
		"incomplete",
		"silent",
		"skipped",
		"repeat_requested",
		"wait_requested":
		return true
	default:
		return false
	}
}

func knownPolicyAction(action string) bool {
	switch action {
	case "complete_question",
		"ask_followup",
		"soft_reprompt",
		"repeat_question",
		"wait",
		"mark_skipped",
		"timebox":
		return true
	default:
		return false
	}
}

func knownTurnCompletionReason(reason string) bool {
	switch reason {
	case "answered", "skipped", "incomplete":
		return true
	default:
		return false
	}
}

func knownQuestionCompletionReason(reason string) bool {
	switch reason {
	case "answered", "skipped", "candidate_silent", "timeboxed":
		return true
	default:
		return false
	}
}

func knownSessionCompletionReason(reason string) bool {
	switch reason {
	case "all_questions_completed", "candidate_ended", "timeboxed", "candidate_requested_stop":
		return true
	default:
		return false
	}
}

func knownRejectedInterruptionReason(reason string) bool {
	switch reason {
	case "backchannel", "noise", "too_short", "low_confidence":
		return true
	default:
		return false
	}
}

func knownSilenceTier(tier string) bool {
	switch tier {
	case "soft_prompt", "wait_extension", "terminal":
		return true
	default:
		return false
	}
}

func knownTranscriptSpeaker(speaker string) bool {
	switch domain.TranscriptSpeaker(speaker) {
	case domain.TranscriptSpeakerCandidate,
		domain.TranscriptSpeakerInterviewer,
		domain.TranscriptSpeakerSystem:
		return true
	default:
		return false
	}
}

func knownPublishedTrack(track string) bool {
	switch track {
	case "microphone", "camera":
		return true
	default:
		return false
	}
}

func secretKeyInJSON(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}

	return secretKeyInValue(value)
}

func secretKeyInValue(value any) (string, bool) {
	object, ok := value.(map[string]any)
	if ok {
		for key, child := range object {
			if isSensitiveKey(key) {
				return key, true
			}
			if secretKey, ok := secretKeyInValue(child); ok {
				return secretKey, true
			}
		}
		return "", false
	}

	array, ok := value.([]any)
	if ok {
		for _, child := range array {
			if secretKey, ok := secretKeyInValue(child); ok {
				return secretKey, true
			}
		}
	}

	return "", false
}

func isSensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
	for _, marker := range []string{
		"token",
		"apikey",
		"secret",
		"authorization",
		"password",
		"bearer",
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}

	return false
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
