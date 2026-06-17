package store

import (
	"bytes"
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

type MemoryStore struct {
	mu       sync.RWMutex
	sessions map[string]domain.Session
	events   map[string]map[string]domain.Event
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		sessions: map[string]domain.Session{},
		events:   map[string]map[string]domain.Event{},
	}
}

func (s *MemoryStore) CreateSession(_ context.Context, session domain.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.sessions[session.ID]; exists {
		return errors.New("session already exists")
	}

	s.sessions[session.ID] = session
	s.events[session.ID] = map[string]domain.Event{}
	return nil
}

func (s *MemoryStore) GetSession(_ context.Context, sessionID string) (domain.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return domain.Session{}, application.ErrSessionNotFound
	}

	session.Events = make([]domain.Event, 0, len(s.events[sessionID]))
	for _, event := range s.events[sessionID] {
		session.Events = append(session.Events, event)
	}
	sort.Slice(session.Events, func(i int, j int) bool {
		if session.Events[i].Sequence == session.Events[j].Sequence {
			if session.Events[i].OccurredAt.Equal(session.Events[j].OccurredAt) {
				return session.Events[i].ID < session.Events[j].ID
			}

			return session.Events[i].OccurredAt.Before(session.Events[j].OccurredAt)
		}

		return session.Events[i].Sequence < session.Events[j].Sequence
	})

	return session, nil
}

func (s *MemoryStore) AppendEvent(_ context.Context, event domain.Event) (application.AppendEventResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.sessions[event.SessionID]
	if !exists {
		return application.AppendEventResult{}, application.ErrSessionNotFound
	}

	sessionEvents := s.events[event.SessionID]
	if existing, exists := sessionEvents[event.ID]; exists {
		if sameEvent(existing, event) {
			return application.AppendEventResult{Event: existing, Duplicate: true}, nil
		}

		return application.AppendEventResult{}, application.ErrEventConflict
	}
	for _, existing := range sessionEvents {
		if existing.IdempotencyKey == event.IdempotencyKey {
			if sameEvent(existing, event) {
				return application.AppendEventResult{Event: existing, Duplicate: true}, nil
			}

			return application.AppendEventResult{}, application.ErrEventConflict
		}
	}

	if event.Sequence != len(sessionEvents)+1 {
		return application.AppendEventResult{}, application.ErrInvalidEvent
	}

	if !domain.CanApplyEvent(session.Status, event.Type) {
		return application.AppendEventResult{}, application.ErrInvalidEvent
	}

	sessionEvents[event.ID] = event
	if status, ok := domain.ValidStatusForEvent(event.Type); ok {
		session.Status = status
	}
	session.UpdatedAt = event.OccurredAt
	s.sessions[event.SessionID] = session

	return application.AppendEventResult{Event: event, Duplicate: false}, nil
}

func sameEvent(left domain.Event, right domain.Event) bool {
	return left.ID == right.ID &&
		left.SessionID == right.SessionID &&
		left.Type == right.Type &&
		left.Actor == right.Actor &&
		left.Sequence == right.Sequence &&
		left.IdempotencyKey == right.IdempotencyKey &&
		left.OccurredAt.Equal(right.OccurredAt) &&
		bytes.Equal(left.Payload, right.Payload)
}
