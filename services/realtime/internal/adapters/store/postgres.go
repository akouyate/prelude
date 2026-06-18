package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strings"

	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type PostgresStore struct {
	db *sql.DB
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("database url is required")
	}

	db, err := sql.Open("pgx", normalizePostgresURL(databaseURL))
	if err != nil {
		return nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &PostgresStore{db: db}, nil
}

func (s *PostgresStore) Close() error {
	return s.db.Close()
}

func (s *PostgresStore) CreateSession(ctx context.Context, session domain.Session) error {
	modalities, err := json.Marshal(session.AllowedModalities)
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		insert into live_interview_sessions (
			id,
			interview_plan_id,
			candidate_id,
			status,
			livekit_room_name,
			allowed_modalities,
			created_at,
			updated_at
		) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
	`, session.ID, session.InterviewPlanID, session.CandidateID, session.Status, session.LiveKitRoomName, string(modalities), session.CreatedAt, session.UpdatedAt)
	if err != nil {
		return err
	}

	return nil
}

func (s *PostgresStore) GetSession(ctx context.Context, sessionID string) (domain.Session, error) {
	session, err := s.getSession(ctx, s.db, sessionID, "")
	if err != nil {
		return domain.Session{}, err
	}

	events, err := s.listEvents(ctx, sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	session.Events = events

	return session, nil
}

func (s *PostgresStore) AppendEvent(ctx context.Context, event domain.Event) (application.AppendEventResult, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return application.AppendEventResult{}, err
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	session, err := s.getSession(ctx, tx, event.SessionID, "for update")
	if err != nil {
		return application.AppendEventResult{}, err
	}
	if strings.TrimSpace(event.CandidateID) == "" {
		event.CandidateID = session.CandidateID
	} else if event.CandidateID != session.CandidateID {
		return application.AppendEventResult{}, application.ErrInvalidEvent
	}

	existing, exists, err := s.findExistingEvent(ctx, tx, event)
	if err != nil {
		return application.AppendEventResult{}, err
	}
	if exists {
		if sameEvent(existing, event) {
			if err := tx.Commit(); err != nil {
				return application.AppendEventResult{}, err
			}
			tx = nil
			return application.AppendEventResult{Event: existing, Duplicate: true}, nil
		}

		return application.AppendEventResult{}, application.ErrEventConflict
	}

	nextSequence, err := s.nextSequence(ctx, tx, event.SessionID)
	if err != nil {
		return application.AppendEventResult{}, err
	}
	if event.Sequence != nextSequence {
		return application.AppendEventResult{}, application.ErrInvalidEvent
	}

	if !domain.CanApplyEvent(session.Status, event.Type) {
		return application.AppendEventResult{}, application.ErrInvalidEvent
	}

	payload := event.Payload
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	providerMetadata := event.ProviderMetadata
	if len(providerMetadata) == 0 {
		providerMetadata = json.RawMessage(`{}`)
	}

	if _, err := tx.ExecContext(ctx, `
		insert into live_interview_events (
			event_id,
			session_id,
			candidate_id,
			actor,
			type,
			occurred_at,
			idempotency_key,
			sequence_number,
			payload,
			provider_metadata
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
	`, event.ID, event.SessionID, event.CandidateID, event.Actor, event.Type, event.OccurredAt, event.IdempotencyKey, event.Sequence, string(payload), string(providerMetadata)); err != nil {
		return application.AppendEventResult{}, err
	}

	if status, ok := domain.ValidStatusForEvent(event.Type); ok {
		session.Status = status
	}
	session.UpdatedAt = event.OccurredAt
	if _, err := tx.ExecContext(ctx, `
		update live_interview_sessions
		set status = $1, updated_at = $2
		where id = $3
	`, session.Status, session.UpdatedAt, session.ID); err != nil {
		return application.AppendEventResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return application.AppendEventResult{}, err
	}
	tx = nil

	return application.AppendEventResult{Event: event, Duplicate: false}, nil
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *PostgresStore) getSession(ctx context.Context, q queryer, sessionID string, lockClause string) (domain.Session, error) {
	query := `
		select id, interview_plan_id, candidate_id, status, livekit_room_name, allowed_modalities, created_at, updated_at
		from live_interview_sessions
		where id = $1
	`
	if lockClause != "" {
		query += " " + lockClause
	}

	var session domain.Session
	var status string
	var modalitiesBytes []byte
	err := q.QueryRowContext(ctx, query, sessionID).Scan(
		&session.ID,
		&session.InterviewPlanID,
		&session.CandidateID,
		&status,
		&session.LiveKitRoomName,
		&modalitiesBytes,
		&session.CreatedAt,
		&session.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Session{}, application.ErrSessionNotFound
	}
	if err != nil {
		return domain.Session{}, err
	}

	session.Status = domain.SessionStatus(status)
	session.AllowedModalities = decodeModalities(modalitiesBytes)

	return session, nil
}

func (s *PostgresStore) listEvents(ctx context.Context, sessionID string) ([]domain.Event, error) {
	rows, err := s.db.QueryContext(ctx, `
		select event_id, session_id, candidate_id, actor, type, occurred_at, idempotency_key, sequence_number, payload, provider_metadata
		from live_interview_events
		where session_id = $1
		order by sequence_number asc, occurred_at asc, event_id asc
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]domain.Event, 0)
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return events, nil
}

func (s *PostgresStore) findExistingEvent(ctx context.Context, tx *sql.Tx, event domain.Event) (domain.Event, bool, error) {
	rows, err := tx.QueryContext(ctx, `
		select event_id, session_id, candidate_id, actor, type, occurred_at, idempotency_key, sequence_number, payload, provider_metadata
		from live_interview_events
		where event_id = $1
			or (session_id = $2 and idempotency_key = $3)
		order by event_id
	`, event.ID, event.SessionID, event.IdempotencyKey)
	if err != nil {
		return domain.Event{}, false, err
	}
	defer rows.Close()

	events := make([]domain.Event, 0, 2)
	for rows.Next() {
		existing, err := scanEvent(rows)
		if err != nil {
			return domain.Event{}, false, err
		}
		events = append(events, existing)
	}
	if err := rows.Err(); err != nil {
		return domain.Event{}, false, err
	}
	if len(events) == 0 {
		return domain.Event{}, false, nil
	}
	sort.Slice(events, func(i int, j int) bool {
		return events[i].ID < events[j].ID
	})

	return events[0], true, nil
}

func (s *PostgresStore) nextSequence(ctx context.Context, tx *sql.Tx, sessionID string) (int, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `
		select count(*)
		from live_interview_events
		where session_id = $1
	`, sessionID).Scan(&count); err != nil {
		return 0, err
	}

	return count + 1, nil
}

type eventScanner interface {
	Scan(dest ...any) error
}

func scanEvent(scanner eventScanner) (domain.Event, error) {
	var event domain.Event
	var actor string
	var eventType string
	var payloadBytes []byte
	var providerMetadataBytes []byte
	if err := scanner.Scan(
		&event.ID,
		&event.SessionID,
		&event.CandidateID,
		&actor,
		&eventType,
		&event.OccurredAt,
		&event.IdempotencyKey,
		&event.Sequence,
		&payloadBytes,
		&providerMetadataBytes,
	); err != nil {
		return domain.Event{}, err
	}

	event.Actor = domain.EventActor(actor)
	event.Type = domain.EventType(eventType)
	event.Payload = append(json.RawMessage(nil), payloadBytes...)
	if len(providerMetadataBytes) > 0 && !bytes.Equal(providerMetadataBytes, []byte(`{}`)) {
		event.ProviderMetadata = append(json.RawMessage(nil), providerMetadataBytes...)
	}

	return event, nil
}

func decodeModalities(value []byte) []domain.Modality {
	var raw []domain.Modality
	if err := json.Unmarshal(value, &raw); err != nil || len(raw) == 0 {
		return []domain.Modality{domain.ModalityAudio}
	}

	return raw
}

func normalizePostgresURL(databaseURL string) string {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return databaseURL
	}

	query := parsed.Query()
	query.Del("schema")
	if query.Get("sslmode") == "" {
		query.Set("sslmode", "disable")
	}
	parsed.RawQuery = query.Encode()

	return parsed.String()
}
