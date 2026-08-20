package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
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

// PurgeExpiredCandidatePreviewData removes preview sessions first so their
// transcript events cascade, then removes the corresponding immutable draft
// snapshots. Preview audio is never recorded by the application service.
//
// This is one of only two places that delete a `live_interview_sessions` row, so
// it is directly exposed to the recording foreign key, which is ON DELETE
// RESTRICT (a recording row is the only handle on an R2 audio object; cascading
// it away would orphan the audio — see the constraint in schema.prisma).
//
// A preview can never hold a recording: startRecordingIfNeeded returns early for
// SessionKindPreview, so no egress is ever started for one. The `not exists`
// guard below is therefore about what happens if that ever stops being true.
// Without it, a single such row would raise 23503 and roll the whole transaction
// back — taking the preview-snapshot cleanup with it — and the sweep would stay
// wedged on every subsequent tick, for every workspace. Stepping around the row
// instead keeps storage limitation working for everyone else, and the skipped
// session is logged loudly: its audio still exists, and only the erasure path
// (EraseRecordingsForSession) may remove it.
func (s *PostgresStore) PurgeExpiredCandidatePreviewData(ctx context.Context, cutoff time.Time) (int64, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	sessionsResult, err := tx.ExecContext(ctx, `
		delete from live_interview_sessions
		where kind = 'preview'
		  and expires_at is not null
		  and expires_at <= $1
		  and not exists (
		    select 1
		    from live_interview_recordings
		    where live_interview_recordings.session_id = live_interview_sessions.id
		  )
	`, cutoff)
	if err != nil {
		return 0, err
	}
	if err := s.warnAboutUnpurgeablePreviews(ctx, tx, cutoff); err != nil {
		return 0, err
	}
	// Deliberately not correlated with the sessions skipped above, unlike the
	// console's own preview cleanup, which keeps a blocked preview's snapshot and
	// session together so the pair stays resolvable. Here the asymmetry is
	// harmless: a preview never records (startRecordingIfNeeded returns early on
	// SessionKindPreview), so the skipped set is empty in practice, and even if
	// drift made it non-empty the recording row and its object key would survive
	// — which is the invariant this file exists to protect.
	previewsResult, err := tx.ExecContext(ctx, `
		delete from "CandidateExperiencePreview"
		where coalesce("runtimeExpiresAt", "expiresAt") <= $1
	`, cutoff)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	sessionsDeleted, err := sessionsResult.RowsAffected()
	if err != nil {
		return 0, err
	}
	previewsDeleted, err := previewsResult.RowsAffected()
	if err != nil {
		return 0, err
	}
	return sessionsDeleted + previewsDeleted, nil
}

// warnAboutUnpurgeablePreviews names the expired preview sessions the sweep just
// stepped over because they still hold recording rows. Silence would be the wrong
// outcome twice over: storage limitation is not being honoured for those sessions,
// and their existence means a preview got recorded, which the application is not
// supposed to allow. Logged at ERROR because both facts want a human.
//
// Reading inside the same transaction keeps the count consistent with the delete
// that just ran.
func (s *PostgresStore) warnAboutUnpurgeablePreviews(ctx context.Context, tx *sql.Tx, cutoff time.Time) error {
	rows, err := tx.QueryContext(ctx, `
		select live_interview_sessions.id
		from live_interview_sessions
		where kind = 'preview'
		  and expires_at is not null
		  and expires_at <= $1
		  and exists (
		    select 1
		    from live_interview_recordings
		    where live_interview_recordings.session_id = live_interview_sessions.id
		  )
		order by live_interview_sessions.id
		limit 20
	`, cutoff)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	var blocked []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		blocked = append(blocked, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(blocked) > 0 {
		slog.Error(
			"expired preview sessions were not purged because they still hold recording rows; erase their audio via the realtime erasure path, then remove the recording rows explicitly before the session",
			"session_ids", strings.Join(blocked, ","),
			"count", len(blocked),
		)
	}

	return nil
}

// DeleteEventsForSession erases a session's transcript by deleting its event
// rows. The event log is append-only by construction — AppendEvent only ever
// inserts — so erasure is a delete, never an in-place redaction; that is also
// what the right-to-erasure ruling requires (deletion, not redaction).
//
// The `live_interview_sessions` row is deliberately NOT touched: deleting it
// would cascade the recording tombstones away with it, and the row is the
// content-free trace Art. 17(3) lets us keep (an interview happened, and when).
// Idempotent — a second call deletes nothing and returns 0.
func (s *PostgresStore) DeleteEventsForSession(ctx context.Context, sessionID string) (int, error) {
	result, err := s.db.ExecContext(ctx, `
		delete from live_interview_events
		where session_id = $1
	`, sessionID)
	if err != nil {
		return 0, err
	}

	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}

	return int(deleted), nil
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
			kind,
			expires_at,
			created_at,
			updated_at
		) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
	`, session.ID, session.InterviewPlanID, session.CandidateID, session.Status, session.LiveKitRoomName, string(modalities), session.Kind, session.ExpiresAt, session.CreatedAt, session.UpdatedAt)
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
	if strings.HasPrefix(planID, "pv_") {
		return s.getCandidatePreviewPlan(ctx, planID)
	}

	var plan application.InterviewPlan
	var seniority sql.NullString
	var roleBrief sql.NullString
	var language sql.NullString
	var responseModesBytes []byte
	var questionsBytes []byte
	var guardrailsBytes []byte

	err := s.db.QueryRowContext(ctx, `
		select id, "roleTitle", seniority, "responseModes", questions, guardrails, "roleBrief", language
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
		&language,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}
	if err != nil {
		return application.InterviewPlan{}, err
	}

	return buildStoredInterviewPlan(storedInterviewPlan{
		ID:            plan.ID,
		RoleTitle:     plan.RoleTitle,
		Seniority:     seniority.String,
		Language:      language.String,
		ResponseModes: responseModesBytes,
		Questions:     questionsBytes,
		Guardrails:    guardrailsBytes,
		RoleBrief:     roleBrief.String,
	})
}

type candidatePreviewSnapshot struct {
	Variant string `json:"variant"`
	Plan    struct {
		RoleTitle     string          `json:"roleTitle"`
		RoleBrief     string          `json:"roleBrief"`
		Seniority     *string         `json:"seniority"`
		Language      *string         `json:"language"`
		ResponseModes json.RawMessage `json:"responseModes"`
		Questions     json.RawMessage `json:"questions"`
		Guardrails    json.RawMessage `json:"guardrails"`
	} `json:"plan"`
}

type storedInterviewPlan struct {
	ID             string
	RoleTitle      string
	Seniority      string
	PreviewVariant string
	// The interview language stamped on the published snapshot. Empty means the
	// snapshot predates language stamping; buildStoredInterviewPlan decides what
	// that falls back to — the caller never guesses on its behalf.
	Language      string
	ResponseModes []byte
	Questions     []byte
	Guardrails    []byte
	RoleBrief     string
}

func (s *PostgresStore) getCandidatePreviewPlan(ctx context.Context, planID string) (application.InterviewPlan, error) {
	var snapshotBytes []byte
	err := s.db.QueryRowContext(ctx, `
		select snapshot
		from "CandidateExperiencePreview"
		where id = $1
		  and "revokedAt" is null
		  and coalesce("runtimeExpiresAt", "expiresAt") > now()
	`, planID).Scan(&snapshotBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}
	if err != nil {
		return application.InterviewPlan{}, err
	}

	return decodeCandidatePreviewPlan(planID, snapshotBytes)
}

func decodeCandidatePreviewPlan(planID string, snapshotBytes []byte) (application.InterviewPlan, error) {
	var snapshot candidatePreviewSnapshot
	if err := json.Unmarshal(snapshotBytes, &snapshot); err != nil {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}
	seniority := ""
	if snapshot.Plan.Seniority != nil {
		seniority = *snapshot.Plan.Seniority
	}
	// A recruiter preview runs the draft the recruiter is editing, so it must be
	// spoken in the draft's own language. A null/absent value is a legacy or
	// never-stamped draft and takes the same fallback as a legacy Interview row.
	language := ""
	if snapshot.Plan.Language != nil {
		language = *snapshot.Plan.Language
	}

	return buildStoredInterviewPlan(storedInterviewPlan{
		ID:            planID,
		RoleTitle:     snapshot.Plan.RoleTitle,
		Seniority:     seniority,
		Language:      language,
		ResponseModes: snapshot.Plan.ResponseModes,
		Questions:     snapshot.Plan.Questions,
		Guardrails:    snapshot.Plan.Guardrails,
		RoleBrief:     snapshot.Plan.RoleBrief,
		PreviewVariant: func() string {
			if snapshot.Variant == "" {
				return "recruiter_preview"
			}
			return snapshot.Variant
		}(),
	})
}

func buildStoredInterviewPlan(stored storedInterviewPlan) (application.InterviewPlan, error) {
	responseModes := decodeStringArray(stored.ResponseModes)
	// The interview language comes from the snapshot the recruiter published
	// (plan 2026-08-18, rule 7). It is threaded into question decoding too, so
	// the category follow-up fallback is authored in the language the agent
	// actually speaks instead of drifting to English mid-interview.
	language := resolveStoredLanguage(stored.Language)
	questions := decodeInterviewQuestions(stored.Questions, language)
	if len(questions) == 0 {
		return application.InterviewPlan{}, application.ErrPlanNotFound
	}

	return application.InterviewPlan{
		ID:                      stored.ID,
		RoleTitle:               stored.RoleTitle,
		Language:                language,
		PreviewVariant:          stored.PreviewVariant,
		Questions:               questions,
		AllowVideo:              containsString(responseModes, "video"),
		AllowAudioOnly:          containsString(responseModes, "audio") || len(responseModes) == 0,
		MaxFollowupsPerQuestion: 1,
		InterviewStyle: application.InterviewStyle{
			Seniority:       stored.Seniority,
			CompanyContext:  summarizeRoleBrief(stored.RoleBrief),
			CandidateTone:   "professional, concise, and concrete",
			RoleConstraints: decodeStringArray(stored.Guardrails),
		},
	}, nil
}

// resolveStoredLanguage keeps the historic "fr" for any snapshot that carries no
// language: those rows were published before stamping existed, and every one of
// them ran a French interview. Falling back to anything else would silently
// switch the spoken language of an already-published role.
func resolveStoredLanguage(language string) string {
	if trimmed := strings.TrimSpace(language); trimmed != "" {
		return trimmed
	}

	return "fr"
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
	if session.Kind == domain.SessionKindPreview && session.ExpiresAt != nil && !session.ExpiresAt.After(time.Now().UTC()) {
		return application.AppendEventResult{}, application.ErrSessionExpired
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
		select id, interview_plan_id, candidate_id, status, livekit_room_name, allowed_modalities, kind, expires_at, created_at, updated_at
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
		&session.Kind,
		&session.ExpiresAt,
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

func decodeInterviewQuestions(value []byte, language string) []application.InterviewQuestion {
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
			FollowUpPrompt: resolveFollowUpPrompt(question.FollowUpPrompt, category, language),
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
func resolveFollowUpPrompt(authored string, category string, language string) string {
	if trimmed := strings.TrimSpace(authored); trimmed != "" {
		return trimmed
	}

	return followUpPrompt(category, language)
}

func followUpPrompt(category string, language string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "fr") {
		switch category {
		case "motivation":
			return "Qu'est-ce qui rend cette opportunité particulièrement pertinente pour la suite de votre parcours ?"
		case "logistics":
			return "Y a-t-il une contrainte pratique que le recruteur devrait connaître dès maintenant ?"
		default: // experience, role_fit
			return "Pouvez-vous décrire le contexte, votre action, et le résultat obtenu ?"
		}
	}

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
		return "HireCall is screening candidates for a structured first interview before recruiter review."
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
// row, missing entitlement, or a null consentedAt means no audio is captured. It
// also reports consentCopyVersion so the application can require an
// audio-disclosing version before recording (consent-v1 disclosed transcript
// evidence only). The Go service reads this console-owned table directly, the
// same shared-DB boundary used for the published Interview plan.
func (s *PostgresStore) RecordingConsentFor(ctx context.Context, sessionID string) (application.RecordingConsent, error) {
	var consentedAt sql.NullTime
	var recordingEntitled sql.NullBool
	var consentCopyVersion sql.NullString
	err := s.db.QueryRowContext(ctx, `
		select "consentedAt", "recordingEntitled", "consentCopyVersion"
		from "CandidateSession"
		where "realtimeSessionId" = $1
	`, sessionID).Scan(&consentedAt, &recordingEntitled, &consentCopyVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return application.RecordingConsent{}, nil
	}
	if err != nil {
		return application.RecordingConsent{}, err
	}

	return application.RecordingConsent{
		Granted:           consentedAt.Valid,
		RecordingEntitled: recordingEntitled.Valid && recordingEntitled.Bool,
		CopyVersion:       consentCopyVersion.String,
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
