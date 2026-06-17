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

type IngestEventInput struct {
	SessionID      string
	EventID        string
	Type           domain.EventType
	Sequence       int
	IdempotencyKey string
	OccurredAt     time.Time
	Payload        json.RawMessage
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
	if len(input.Payload) == 0 {
		input.Payload = json.RawMessage(`{}`)
	}
	if !json.Valid(input.Payload) {
		return IngestEventOutput{}, fmt.Errorf("%w: payload must be valid json", ErrInvalidInput)
	}
	if input.OccurredAt.IsZero() {
		input.OccurredAt = s.clock.Now()
	}

	event := domain.Event{
		ID:             input.EventID,
		SessionID:      input.SessionID,
		Type:           input.Type,
		Sequence:       input.Sequence,
		IdempotencyKey: input.IdempotencyKey,
		OccurredAt:     input.OccurredAt.UTC(),
		Payload:        input.Payload,
	}

	result, err := s.repository.AppendEvent(ctx, event)
	if err != nil {
		return IngestEventOutput{}, err
	}

	return IngestEventOutput{Event: result.Event, Duplicate: result.Duplicate}, nil
}

func knownEventType(eventType domain.EventType) bool {
	switch eventType {
	case domain.EventSessionStarted,
		domain.EventCandidateJoined,
		domain.EventAgentJoined,
		domain.EventQuestionAsked,
		domain.EventCandidateTurnStarted,
		domain.EventCandidateTurnFinalized,
		domain.EventFollowupAsked,
		domain.EventQuestionCompleted,
		domain.EventSessionCompleted,
		domain.EventSessionFailed:
		return true
	default:
		return false
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
