package domain

import (
	"encoding/json"
	"time"
)

type SessionStatus string

const (
	SessionStatusCreated          SessionStatus = "created"
	SessionStatusWaitingCandidate SessionStatus = "waiting_candidate"
	SessionStatusAgentJoining     SessionStatus = "agent_joining"
	SessionStatusInProgress       SessionStatus = "in_progress"
	SessionStatusPaused           SessionStatus = "paused"
	SessionStatusCompleted        SessionStatus = "completed"
	SessionStatusFailed           SessionStatus = "failed"
	SessionStatusExpired          SessionStatus = "expired"
)

type Modality string

const (
	ModalityForm  Modality = "form"
	ModalityAudio Modality = "audio"
	ModalityVideo Modality = "video"
)

type EventType string

const (
	EventSessionStarted         EventType = "session_started"
	EventCandidateJoined        EventType = "candidate_joined"
	EventAgentJoined            EventType = "agent_joined"
	EventAgentSpeechStarted     EventType = "agent_speech_started"
	EventAgentSpeechCompleted   EventType = "agent_speech_completed"
	EventAgentSpeechInterrupted EventType = "agent_speech_interrupted"
	EventQuestionAsked          EventType = "question_asked"
	EventQuestionRepeated       EventType = "question_repeated"
	EventCandidateSpeechStarted EventType = "candidate_speech_started"
	EventCandidateSpeechStopped EventType = "candidate_speech_stopped"
	EventCandidateTurnDetected  EventType = "candidate_turn_detected"
	EventCandidateTurnStarted   EventType = "candidate_turn_started"
	EventCandidateTurnFinalized EventType = "candidate_turn_finalized"
	EventBargeInDetected        EventType = "barge_in_detected"
	EventBargeInAccepted        EventType = "barge_in_accepted"
	EventBargeInRejected        EventType = "barge_in_rejected"
	EventBackchannelDetected    EventType = "backchannel_detected"
	EventSilenceTimeoutStarted  EventType = "silence_timeout_started"
	EventWaitRequested          EventType = "wait_requested"
	EventSoftReprompted         EventType = "soft_reprompted"
	EventFollowupAsked          EventType = "followup_asked"
	EventQuestionCompleted      EventType = "question_completed"
	EventSessionClosing         EventType = "session_closing"
	EventSessionCompleted       EventType = "session_completed"
	EventSessionFailed          EventType = "session_failed"
)

type EventActor string

const (
	EventActorAgent     EventActor = "agent"
	EventActorCandidate EventActor = "candidate"
	EventActorSystem    EventActor = "system"
)

type Session struct {
	ID                string        `json:"id"`
	InterviewPlanID   string        `json:"interview_plan_id"`
	CandidateID       string        `json:"candidate_id"`
	Status            SessionStatus `json:"status"`
	LiveKitRoomName   string        `json:"livekit_room_name"`
	AllowedModalities []Modality    `json:"allowed_modalities"`
	CreatedAt         time.Time     `json:"created_at"`
	UpdatedAt         time.Time     `json:"updated_at"`
	Events            []Event       `json:"events,omitempty"`
}

type Event struct {
	ID             string          `json:"event_id"`
	SessionID      string          `json:"session_id"`
	Type           EventType       `json:"type"`
	Actor          EventActor      `json:"actor"`
	Sequence       int             `json:"sequence"`
	IdempotencyKey string          `json:"idempotency_key"`
	OccurredAt     time.Time       `json:"occurred_at"`
	Payload        json.RawMessage `json:"payload"`
}

func ValidStatusForEvent(eventType EventType) (SessionStatus, bool) {
	switch eventType {
	case EventCandidateJoined:
		return SessionStatusAgentJoining, true
	case EventAgentJoined:
		return SessionStatusInProgress, true
	case EventSessionStarted:
		return SessionStatusInProgress, true
	case EventSessionCompleted:
		return SessionStatusCompleted, true
	case EventSessionFailed:
		return SessionStatusFailed, true
	default:
		return "", false
	}
}

func CanApplyEvent(status SessionStatus, eventType EventType) bool {
	if status == SessionStatusCompleted || status == SessionStatusFailed || status == SessionStatusExpired {
		return false
	}

	switch eventType {
	case EventCandidateJoined:
		return status == SessionStatusWaitingCandidate || status == SessionStatusCreated
	case EventAgentJoined:
		return status == SessionStatusAgentJoining || status == SessionStatusWaitingCandidate
	case EventSessionStarted:
		return status == SessionStatusInProgress || status == SessionStatusAgentJoining || status == SessionStatusWaitingCandidate || status == SessionStatusCreated
	case EventSessionFailed:
		return true
	case EventSessionCompleted,
		EventAgentSpeechStarted,
		EventAgentSpeechCompleted,
		EventAgentSpeechInterrupted,
		EventQuestionAsked,
		EventQuestionRepeated,
		EventCandidateSpeechStarted,
		EventCandidateSpeechStopped,
		EventCandidateTurnDetected,
		EventCandidateTurnStarted,
		EventCandidateTurnFinalized,
		EventBargeInDetected,
		EventBargeInAccepted,
		EventBargeInRejected,
		EventBackchannelDetected,
		EventSilenceTimeoutStarted,
		EventWaitRequested,
		EventSoftReprompted,
		EventFollowupAsked,
		EventSessionClosing,
		EventQuestionCompleted:
		return status == SessionStatusInProgress
	default:
		return false
	}
}
