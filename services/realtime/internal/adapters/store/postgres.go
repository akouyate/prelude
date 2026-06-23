package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

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

func (s *PostgresStore) GetInterviewPlan(ctx context.Context, planID string) (application.InterviewPlan, error) {
	var plan application.InterviewPlan
	var seniority sql.NullString
	var roleBrief sql.NullString
	var responseModesBytes []byte
	var questionsBytes []byte
	var guardrailsBytes []byte

	err := s.db.QueryRowContext(ctx, `
		select id, "roleTitle", seniority, "responseModes", questions, guardrails, "roleBrief"
		from "Interview"
		where id = $1 and status = 'published'
	`, planID).Scan(
		&plan.ID,
		&plan.RoleTitle,
		&seniority,
		&responseModesBytes,
		&questionsBytes,
		&guardrailsBytes,
		&roleBrief,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}
	if err != nil {
		return application.InterviewPlan{}, err
	}

	responseModes := decodeStringArray(responseModesBytes)
	questions := decodeInterviewQuestions(questionsBytes)
	if len(questions) == 0 {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}

	plan.Language = "fr"
	plan.Questions = questions
	plan.AllowVideo = containsString(responseModes, "video")
	plan.AllowAudioOnly = containsString(responseModes, "audio") || len(responseModes) == 0
	plan.MaxFollowupsPerQuestion = 1
	plan.InterviewStyle = application.InterviewStyle{
		Seniority:       seniority.String,
		CompanyContext:  summarizeRoleBrief(roleBrief.String),
		CandidateTone:   "professional, concise, and concrete",
		RoleConstraints: decodeStringArray(guardrailsBytes),
	}

	return plan, nil
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

type persistedQuestion struct {
	ID             string `json:"id"`
	Prompt         string `json:"prompt"`
	Category       string `json:"category"`
	ExpectedSignal string `json:"expectedSignal"`
	FollowUpPrompt string `json:"followUpPrompt"`
	Source         string `json:"source"`
}

func decodeInterviewQuestions(value []byte) []application.InterviewQuestion {
	var raw []persistedQuestion
	if err := json.Unmarshal(value, &raw); err != nil {
		return []application.InterviewQuestion{}
	}

	questions := make([]application.InterviewQuestion, 0, len(raw))
	for index, question := range raw {
		prompt := strings.TrimSpace(question.Prompt)
		if prompt == "" {
			continue
		}
		id := strings.TrimSpace(question.ID)
		if id == "" {
			id = "q" + strconv.Itoa(index+1)
		}

		category := clampQuestionCategory(question.Category)
		questions = append(questions, application.InterviewQuestion{
			ID:             id,
			Prompt:         prompt,
			Category:       category,
			ExpectedSignal: strings.TrimSpace(question.ExpectedSignal),
			FollowUpPrompt: resolveFollowUpPrompt(question.FollowUpPrompt, category),
		})
	}

	return questions
}

func decodeStringArray(value []byte) []string {
	var raw []string
	if err := json.Unmarshal(value, &raw); err != nil {
		return []string{}
	}

	items := make([]string, 0, len(raw))
	for _, item := range raw {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			items = append(items, trimmed)
		}
	}

	return items
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}

	return false
}

// clampQuestionCategory maps the recruiter-approved category (the canonical
// interview-plan set: motivation/experience/skills/logistics/availability/
// compensation/custom) onto the live worker's strict QuestionCategory StrEnum
// {motivation, experience, logistics, role_fit}. The Python agent binds this
// field to that enum, so any out-of-set value (skills/availability/compensation/
// custom, or a legacy heuristic value) crashes its AgentConfig validation and the
// agent never joins — so everything outside the three shared values clamps to
// role_fit.
func clampQuestionCategory(category string) string {
	switch strings.TrimSpace(strings.ToLower(category)) {
	case "motivation":
		return "motivation"
	case "experience":
		return "experience"
	case "logistics":
		return "logistics"
	default:
		return "role_fit"
	}
}

// resolveFollowUpPrompt prefers the recruiter-authored, reviewed, and
// compliance-scanned follow-up persisted on the question, and only falls back to
// the generic category default when the plan has none (e.g. a legacy row written
// before the field existed).
func resolveFollowUpPrompt(authored string, category string) string {
	if trimmed := strings.TrimSpace(authored); trimmed != "" {
		return trimmed
	}

	return followUpPrompt(category)
}

func followUpPrompt(category string) string {
	switch category {
	case "motivation":
		return "What makes this opportunity specifically relevant for your next step?"
	case "logistics":
		return "Is there any practical constraint the recruiter should know now?"
	default: // experience, role_fit
		return "Can you share the context, your action, and the result?"
	}
}

func summarizeRoleBrief(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Prelude is screening candidates for a structured first interview before recruiter review."
	}
	if len(value) <= 220 {
		return value
	}

	return strings.TrimSpace(value[:220]) + "..."
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

func (s *PostgresStore) CreateRecording(ctx context.Context, recording domain.Recording) error {
	_, err := s.db.ExecContext(ctx, `
		insert into live_interview_recordings (
			id,
			session_id,
			egress_id,
			object_key,
			status,
			format,
			layout,
			duration_ms,
			failed_reason,
			started_at,
			ended_at,
			created_at,
			updated_at
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`,
		recording.ID,
		recording.SessionID,
		nullString(recording.EgressID),
		nullString(recording.ObjectKey),
		string(recording.Status),
		recording.Format,
		nullString(recording.Layout),
		nullInt(recording.DurationMs),
		nullString(recording.FailedReason),
		recording.StartedAt,
		nullTime(recording.EndedAt),
		recording.CreatedAt,
		recording.UpdatedAt,
	)

	return err
}

func (s *PostgresStore) ActiveRecordingForSession(ctx context.Context, sessionID string) (domain.Recording, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		select id, session_id, egress_id, object_key, status, format, layout, duration_ms, failed_reason, started_at, ended_at, created_at, updated_at, deleted_at, deleted_reason
		from live_interview_recordings
		where session_id = $1 and status = $2
		order by started_at desc
		limit 1
	`, sessionID, string(domain.RecordingStatusRecording))

	recording, err := scanRecording(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Recording{}, false, nil
	}
	if err != nil {
		return domain.Recording{}, false, err
	}

	return recording, true, nil
}

func (s *PostgresStore) FinalizeRecordingByEgressID(ctx context.Context, input application.FinalizeRecordingInput) (bool, error) {
	if strings.TrimSpace(input.EgressID) == "" {
		return false, nil
	}

	result, err := s.db.ExecContext(ctx, `
		update live_interview_recordings
		set status = $1, duration_ms = $2, ended_at = $3, updated_at = $4
		where egress_id = $5 and status = $6
	`,
		string(input.Status),
		nullInt(input.DurationMs),
		nullTimeValue(input.EndedAt),
		input.UpdatedAt,
		input.EgressID,
		string(domain.RecordingStatusRecording),
	)
	if err != nil {
		return false, err
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}

	return affected > 0, nil
}

func scanRecording(scanner eventScanner) (domain.Recording, error) {
	var recording domain.Recording
	var egressID sql.NullString
	var objectKey sql.NullString
	var layout sql.NullString
	var durationMs sql.NullInt64
	var failedReason sql.NullString
	var endedAt sql.NullTime
	var deletedAt sql.NullTime
	var deletedReason sql.NullString
	var status string
	if err := scanner.Scan(
		&recording.ID,
		&recording.SessionID,
		&egressID,
		&objectKey,
		&status,
		&recording.Format,
		&layout,
		&durationMs,
		&failedReason,
		&recording.StartedAt,
		&endedAt,
		&recording.CreatedAt,
		&recording.UpdatedAt,
		&deletedAt,
		&deletedReason,
	); err != nil {
		return domain.Recording{}, err
	}

	recording.Status = domain.RecordingStatus(status)
	recording.EgressID = egressID.String
	recording.ObjectKey = objectKey.String
	recording.Layout = layout.String
	recording.FailedReason = failedReason.String
	recording.DeletedReason = deletedReason.String
	if durationMs.Valid {
		value := int(durationMs.Int64)
		recording.DurationMs = &value
	}
	if endedAt.Valid {
		ended := endedAt.Time
		recording.EndedAt = &ended
	}
	if deletedAt.Valid {
		deleted := deletedAt.Time
		recording.DeletedAt = &deleted
	}

	return recording, nil
}

func nullString(value string) any {
	if value == "" {
		return nil
	}

	return value
}

func nullInt(value *int) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullTime(value *time.Time) any {
	if value == nil {
		return nil
	}

	return *value
}

func nullTimeValue(value time.Time) any {
	if value.IsZero() {
		return nil
	}

	return value
}

// RecordingConsentFor derives recording consent from the console's
// CandidateSession row linked by realtimeSessionId. It is fail-closed: a missing
// row or a null consentedAt means consent has not been granted, so no audio is
// captured. It also reports consentCopyVersion so the application can require an
// audio-disclosing version before recording (consent-v1 disclosed transcript
// evidence only). The Go service reads this console-owned table directly, the
// same shared-DB boundary used for the published Interview plan.
func (s *PostgresStore) RecordingConsentFor(ctx context.Context, sessionID string) (application.RecordingConsent, error) {
	var consentedAt sql.NullTime
	var consentCopyVersion sql.NullString
	err := s.db.QueryRowContext(ctx, `
		select "consentedAt", "consentCopyVersion"
		from "CandidateSession"
		where "realtimeSessionId" = $1
	`, sessionID).Scan(&consentedAt, &consentCopyVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return application.RecordingConsent{}, nil
	}
	if err != nil {
		return application.RecordingConsent{}, err
	}

	return application.RecordingConsent{
		Granted:     consentedAt.Valid,
		CopyVersion: consentCopyVersion.String,
	}, nil
}

func (s *PostgresStore) StaleRecordings(ctx context.Context, startedBefore time.Time, limit int) ([]domain.Recording, error) {
	rows, err := s.db.QueryContext(ctx, `
		select id, session_id, egress_id, object_key, status, format, layout, duration_ms, failed_reason, started_at, ended_at, created_at, updated_at, deleted_at, deleted_reason
		from live_interview_recordings
		where status = $1 and started_at < $2
		order by started_at asc
		limit $3
	`, string(domain.RecordingStatusRecording), startedBefore, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recordings := make([]domain.Recording, 0)
	for rows.Next() {
		recording, err := scanRecording(rows)
		if err != nil {
			return nil, err
		}
		recordings = append(recordings, recording)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return recordings, nil
}

func (s *PostgresStore) DeletableRecordings(ctx context.Context, deletedBefore time.Time, limit int) ([]domain.Recording, error) {
	rows, err := s.db.QueryContext(ctx, `
		select id, session_id, egress_id, object_key, status, format, layout, duration_ms, failed_reason, started_at, ended_at, created_at, updated_at, deleted_at, deleted_reason
		from live_interview_recordings
		where status = $1 and coalesce(ended_at, started_at) < $2
		order by coalesce(ended_at, started_at) asc
		limit $3
	`, string(domain.RecordingStatusAvailable), deletedBefore, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recordings := make([]domain.Recording, 0)
	for rows.Next() {
		recording, err := scanRecording(rows)
		if err != nil {
			return nil, err
		}
		recordings = append(recordings, recording)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return recordings, nil
}

func (s *PostgresStore) MarkRecordingDeleted(ctx context.Context, input application.MarkRecordingDeletedInput) error {
	_, err := s.db.ExecContext(ctx, `
		update live_interview_recordings
		set status = $1, object_key = null, deleted_at = $2, deleted_reason = $3, updated_at = $4
		where id = $5
	`,
		string(domain.RecordingStatusDeleted),
		input.DeletedAt,
		nullString(input.Reason),
		input.DeletedAt,
		input.ID,
	)

	return err
}

func (s *PostgresStore) RecordingsForSession(ctx context.Context, sessionID string) ([]domain.Recording, error) {
	rows, err := s.db.QueryContext(ctx, `
		select id, session_id, egress_id, object_key, status, format, layout, duration_ms, failed_reason, started_at, ended_at, created_at, updated_at, deleted_at, deleted_reason
		from live_interview_recordings
		where session_id = $1
		order by started_at asc
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recordings := make([]domain.Recording, 0)
	for rows.Next() {
		recording, err := scanRecording(rows)
		if err != nil {
			return nil, err
		}
		recordings = append(recordings, recording)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return recordings, nil
}
