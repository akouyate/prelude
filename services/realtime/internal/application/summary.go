package application

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

const recruiterSummaryVersion = "recruiter-summary-v1-deterministic"

var defaultComplianceFlags = []string{
	"human_review_required",
	"job_related_questions_only",
	"protected_traits_excluded",
	"biometric_scoring_disallowed",
}

type RecruiterSummary struct {
	SummaryID                string                `json:"summary_id"`
	SessionID                string                `json:"session_id"`
	CandidateID              string                `json:"candidate_id"`
	PlanID                   string                `json:"plan_id"`
	RoleTitle                string                `json:"role_title"`
	Status                   string                `json:"status"`
	GeneratedAt              time.Time             `json:"generated_at"`
	SummaryVersion           string                `json:"summary_version"`
	Generator                string                `json:"generator"`
	Disclaimer               string                `json:"disclaimer"`
	Overview                 string                `json:"overview"`
	Recommendation           SummaryRecommendation `json:"recommendation"`
	Criteria                 []SummaryCriterion    `json:"criteria"`
	Strengths                []SummarySignal       `json:"strengths"`
	Risks                    []SummarySignal       `json:"risks"`
	QuestionNotes            []SummaryQuestionNote `json:"question_notes"`
	FollowUpQuestions        []string              `json:"follow_up_questions"`
	LogisticsNotes           []string              `json:"logistics_notes"`
	MissingInformation       []string              `json:"missing_information"`
	ExcludedSensitiveSignals []string              `json:"excluded_sensitive_signals"`
	ComplianceFlags          []string              `json:"compliance_flags"`
	Audit                    RecruiterSummaryAudit `json:"audit"`
}

type SummaryRecommendation struct {
	Value     string `json:"value"`
	Label     string `json:"label"`
	Rationale string `json:"rationale"`
}

type SummaryCriterion struct {
	CriterionID string            `json:"criterion_id"`
	Label       string            `json:"label"`
	Category    string            `json:"category"`
	Status      string            `json:"status"`
	Evidence    []SummaryEvidence `json:"evidence"`
	Note        string            `json:"note"`
}

type SummarySignal struct {
	Title       string            `json:"title"`
	Explanation string            `json:"explanation"`
	Confidence  string            `json:"confidence"`
	Evidence    []SummaryEvidence `json:"evidence"`
}

type SummaryQuestionNote struct {
	QuestionID    string            `json:"question_id"`
	Prompt        string            `json:"prompt"`
	Category      string            `json:"category"`
	AnswerStatus  string            `json:"answer_status"`
	AnswerSummary string            `json:"answer_summary"`
	Evidence      []SummaryEvidence `json:"evidence"`
}

type SummaryEvidence struct {
	EventID    string                   `json:"event_id"`
	TurnID     string                   `json:"turn_id,omitempty"`
	QuestionID string                   `json:"question_id,omitempty"`
	Speaker    domain.TranscriptSpeaker `json:"speaker"`
	Quote      string                   `json:"quote"`
}

type RecruiterSummaryAudit struct {
	SourceEventIDs                []string `json:"source_event_ids"`
	TranscriptTurnIDs             []string `json:"transcript_turn_ids"`
	TemplateVersion               string   `json:"template_version"`
	GeneratedFromCompletedSession bool     `json:"generated_from_completed_session"`
}

type answerEvaluation struct {
	QuestionID            string            `json:"question_id"`
	QuestionIDCamel       string            `json:"questionId"`
	TurnIDs               []string          `json:"turn_ids"`
	TurnIDsCamel          []string          `json:"turnIds"`
	Classification        string            `json:"classification"`
	PolicyAction          string            `json:"policy_action"`
	PolicyActionCamel     string            `json:"policyAction"`
	EvaluationMatrix      *evaluationMatrix `json:"evaluation_matrix"`
	EvaluationMatrixCamel *evaluationMatrix `json:"evaluationMatrix"`
}

type evaluationMatrix struct {
	OverallScore      int                   `json:"overall_score"`
	OverallScoreCamel int                   `json:"overallScore"`
	MaxScore          int                   `json:"max_score"`
	MaxScoreCamel     int                   `json:"maxScore"`
	Dimensions        []evaluationDimension `json:"dimensions"`
	Challenge         evaluationChallenge   `json:"challenge"`
}

type evaluationDimension struct {
	Name      string `json:"name"`
	Score     int    `json:"score"`
	Rationale string `json:"rationale"`
}

type evaluationChallenge struct {
	Needed bool   `json:"needed"`
	Reason string `json:"reason"`
	Prompt string `json:"prompt"`
}

type candidateAnswer struct {
	event domain.Event
	turn  domain.TranscriptTurn
}

func (s *Service) GetRecruiterSummary(ctx context.Context, sessionID string) (RecruiterSummary, error) {
	session, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return RecruiterSummary{}, err
	}

	plan, _, err := s.resolveInterviewPlan(ctx, session.InterviewPlanID)
	if err != nil {
		return RecruiterSummary{}, err
	}

	return buildRecruiterSummary(session, plan, s.clock.Now().UTC()), nil
}

func buildRecruiterSummary(session domain.Session, plan InterviewPlan, generatedAt time.Time) RecruiterSummary {
	answersByQuestion := map[string][]candidateAnswer{}
	evaluationsByQuestion := map[string]answerEvaluation{}
	sourceEventIDs := make([]string, 0, len(session.Events))
	transcriptTurnIDs := make([]string, 0)
	excludedSensitiveSignals := make([]string, 0)

	for _, event := range session.Events {
		sourceEventIDs = append(sourceEventIDs, event.ID)

		if turn, ok := transcriptTurnFromEvent(event); ok {
			transcriptTurnIDs = append(transcriptTurnIDs, turn.TurnID)
			if turn.Speaker == domain.TranscriptSpeakerCandidate {
				if reason, sensitive := sensitiveRecruiterSignal(turn.Text); sensitive {
					excludedSensitiveSignals = appendUnique(excludedSensitiveSignals, reason)
					continue
				}
				answersByQuestion[turn.QuestionID] = append(answersByQuestion[turn.QuestionID], candidateAnswer{
					event: event,
					turn:  turn,
				})
			}
		}

		if event.Type == domain.EventAnswerEvaluated {
			if evaluation, ok := parseAnswerEvaluation(event.Payload); ok {
				evaluationsByQuestion[evaluation.questionID()] = evaluation
			}
		}
	}

	criteria := make([]SummaryCriterion, 0, len(plan.Questions))
	questionNotes := make([]SummaryQuestionNote, 0, len(plan.Questions))
	strengths := make([]SummarySignal, 0)
	risks := make([]SummarySignal, 0)
	followUps := make([]string, 0)
	missing := make([]string, 0)
	logisticsNotes := make([]string, 0)
	answeredQuestions := 0

	for _, question := range plan.Questions {
		answers := answersByQuestion[question.ID]
		evidence := evidenceFromAnswers(answers, 2)
		evaluation := evaluationsByQuestion[question.ID]
		status := criterionStatus(answers, evaluation)

		if len(answers) > 0 {
			answeredQuestions++
		}

		criteria = append(criteria, SummaryCriterion{
			CriterionID: question.ID,
			Label:       criterionLabel(question),
			Category:    question.Category,
			Status:      status,
			Evidence:    evidence,
			Note:        criterionNote(question, status, evaluation),
		})

		questionNotes = append(questionNotes, SummaryQuestionNote{
			QuestionID:    question.ID,
			Prompt:        question.Prompt,
			Category:      question.Category,
			AnswerStatus:  status,
			AnswerSummary: answerSummary(question, status, answers, evaluation),
			Evidence:      evidence,
		})

		switch status {
		case "satisfied":
			if len(strengths) < 4 && question.Category != "logistics" {
				strengths = append(strengths, SummarySignal{
					Title:       fmt.Sprintf("%s signal captured", criterionLabel(question)),
					Explanation: fmt.Sprintf("The answer gives the recruiter usable evidence for %s.", strings.ToLower(criterionLabel(question))),
					Confidence:  "medium",
					Evidence:    evidence,
				})
			}
		case "unclear":
			risks = append(risks, SummarySignal{
				Title:       fmt.Sprintf("%s needs validation", criterionLabel(question)),
				Explanation: matrixRiskExplanation(evaluation),
				Confidence:  "medium",
				Evidence:    evidence,
			})
			followUps = append(followUps, followUpFor(question))
		case "missing":
			missing = append(missing, fmt.Sprintf("%s was not captured.", criterionLabel(question)))
			risks = append(risks, SummarySignal{
				Title:       fmt.Sprintf("%s missing", criterionLabel(question)),
				Explanation: "The planned first-screen question was not answered, so the recruiter should not infer this signal.",
				Confidence:  "high",
				Evidence:    []SummaryEvidence{},
			})
			followUps = append(followUps, followUpFor(question))
		}

		if question.Category == "logistics" {
			if len(evidence) > 0 {
				logisticsNotes = append(logisticsNotes, summarizeQuote(evidence[0].Quote))
			} else {
				logisticsNotes = append(logisticsNotes, "Availability and practical constraints were not captured.")
			}
		}
	}

	if len(strengths) == 0 {
		strengths = append(strengths, SummarySignal{
			Title:       "No strong signal yet",
			Explanation: "The transcript does not contain enough non-sensitive candidate evidence to highlight a strength.",
			Confidence:  "low",
			Evidence:    []SummaryEvidence{},
		})
	}

	status := "incomplete"
	if session.Status == domain.SessionStatusCompleted {
		status = "complete"
	}

	recommendation := recommendationFor(status, answeredQuestions, len(plan.Questions), len(risks), len(excludedSensitiveSignals))
	overview := fmt.Sprintf(
		"The candidate answered %d of %d planned first-screen questions for %s. This summary is evidence-backed and intended for recruiter review.",
		answeredQuestions,
		len(plan.Questions),
		plan.RoleTitle,
	)
	if len(excludedSensitiveSignals) > 0 {
		overview += " Potential sensitive signals were excluded from the recruiter-facing readout."
	}

	if len(followUps) == 0 {
		followUps = append(followUps, "Validate the strongest role-fit claim with a concrete example in the recruiter call.")
	}

	return RecruiterSummary{
		SummaryID:                "rs_" + session.ID,
		SessionID:                session.ID,
		CandidateID:              session.CandidateID,
		PlanID:                   plan.ID,
		RoleTitle:                plan.RoleTitle,
		Status:                   status,
		GeneratedAt:              generatedAt,
		SummaryVersion:           recruiterSummaryVersion,
		Generator:                "deterministic_v1",
		Disclaimer:               "This summary supports recruiter review and is not an automated hiring decision.",
		Overview:                 overview,
		Recommendation:           recommendation,
		Criteria:                 criteria,
		Strengths:                strengths,
		Risks:                    risks,
		QuestionNotes:            questionNotes,
		FollowUpQuestions:        dedupeStrings(followUps),
		LogisticsNotes:           dedupeStrings(logisticsNotes),
		MissingInformation:       dedupeStrings(missing),
		ExcludedSensitiveSignals: excludedSensitiveSignals,
		ComplianceFlags:          complianceFlags(excludedSensitiveSignals),
		Audit: RecruiterSummaryAudit{
			SourceEventIDs:                sourceEventIDs,
			TranscriptTurnIDs:             transcriptTurnIDs,
			TemplateVersion:               recruiterSummaryVersion,
			GeneratedFromCompletedSession: session.Status == domain.SessionStatusCompleted,
		},
	}
}

func complianceFlags(excludedSensitiveSignals []string) []string {
	flags := append([]string{}, defaultComplianceFlags...)
	if len(excludedSensitiveSignals) > 0 {
		flags = append(flags, "sensitive_signal_review_required")
	}
	return flags
}

func parseAnswerEvaluation(raw json.RawMessage) (answerEvaluation, bool) {
	var evaluation answerEvaluation
	if err := json.Unmarshal(raw, &evaluation); err != nil {
		return answerEvaluation{}, false
	}
	return evaluation, evaluation.questionID() != ""
}

func (e answerEvaluation) questionID() string {
	return firstNonEmpty(e.QuestionID, e.QuestionIDCamel)
}

func (e answerEvaluation) turnIDs() []string {
	if len(e.TurnIDsCamel) > 0 {
		return e.TurnIDsCamel
	}
	return e.TurnIDs
}

func (e answerEvaluation) matrix() *evaluationMatrix {
	if e.EvaluationMatrixCamel != nil {
		return e.EvaluationMatrixCamel
	}
	return e.EvaluationMatrix
}

func criterionStatus(answers []candidateAnswer, evaluation answerEvaluation) string {
	if len(answers) == 0 {
		return "missing"
	}
	if evaluation.Classification == "vague" || evaluation.Classification == "incomplete" || evaluation.Classification == "silent" || evaluation.Classification == "skipped" {
		return "unclear"
	}
	for _, answer := range answers {
		if len([]rune(answer.turn.Text)) < 36 {
			return "unclear"
		}
	}
	return "satisfied"
}

func criterionLabel(question InterviewQuestion) string {
	switch question.Category {
	case "motivation":
		return "Motivation"
	case "experience":
		return "Relevant experience"
	case "skills":
		return "Role skills"
	case "logistics", "availability":
		return "Logistics"
	case "compensation":
		return "Compensation alignment"
	default:
		return "Role signal"
	}
}

func criterionNote(question InterviewQuestion, status string, evaluation answerEvaluation) string {
	switch status {
	case "satisfied":
		return fmt.Sprintf("Usable evidence was captured for %s.", strings.ToLower(criterionLabel(question)))
	case "unclear":
		if matrix := evaluation.matrix(); matrix != nil && matrix.Challenge.Reason != "" {
			return fmt.Sprintf("%s was challenged by the live interviewer: %s.", criterionLabel(question), humanizeReason(matrix.Challenge.Reason))
		}
		return fmt.Sprintf("%s was partially captured but needs recruiter validation.", criterionLabel(question))
	default:
		return fmt.Sprintf("%s was not captured in the interview.", criterionLabel(question))
	}
}

func answerSummary(question InterviewQuestion, status string, answers []candidateAnswer, evaluation answerEvaluation) string {
	switch status {
	case "satisfied":
		return "The candidate gave a usable answer that can support recruiter review."
	case "unclear":
		if matrix := evaluation.matrix(); matrix != nil && matrix.Challenge.Prompt != "" {
			return "The live interviewer challenged the answer because the evaluation matrix found a weak signal."
		}
		return "The candidate responded, but the answer needs clarification before it can support a hiring step."
	default:
		return fmt.Sprintf("No candidate answer was captured for: %s", question.Prompt)
	}
}

func matrixRiskExplanation(evaluation answerEvaluation) string {
	matrix := evaluation.matrix()
	if matrix == nil {
		return "The candidate answered, but the signal is too thin for a confident first-screen read."
	}
	weak := make([]string, 0)
	for _, dimension := range matrix.Dimensions {
		if dimension.Score < 2 {
			weak = append(weak, strings.ReplaceAll(dimension.Name, "_", " "))
		}
	}
	if len(weak) == 0 {
		return "The live evaluation matrix marked the answer as needing recruiter validation."
	}
	return fmt.Sprintf("The live evaluation matrix found weak %s.", strings.Join(weak, ", "))
}

func humanizeReason(reason string) string {
	return strings.ReplaceAll(reason, "_", " ")
}

func evidenceFromAnswers(answers []candidateAnswer, limit int) []SummaryEvidence {
	evidence := make([]SummaryEvidence, 0, limit)
	for _, answer := range answers {
		if len(evidence) >= limit {
			break
		}
		evidence = append(evidence, SummaryEvidence{
			EventID:    answer.event.ID,
			TurnID:     answer.turn.TurnID,
			QuestionID: answer.turn.QuestionID,
			Speaker:    answer.turn.Speaker,
			Quote:      summarizeQuote(answer.turn.Text),
		})
	}
	return evidence
}

func summarizeQuote(text string) string {
	normalized := strings.Join(strings.Fields(text), " ")
	if len([]rune(normalized)) <= 220 {
		return normalized
	}
	runes := []rune(normalized)
	return string(runes[:217]) + "..."
}

func followUpFor(question InterviewQuestion) string {
	switch question.Category {
	case "logistics", "availability":
		return "Can you confirm availability, location constraints, and practical requirements for the next step?"
	case "motivation":
		return "What specifically makes this role and company context a strong next step for you?"
	case "experience":
		return "Can you walk through one concrete example with context, action, and result?"
	default:
		return fmt.Sprintf("Can you give a concrete example that validates this signal: %s", question.Prompt)
	}
}

func recommendationFor(status string, answeredQuestions int, totalQuestions int, riskCount int, excludedCount int) SummaryRecommendation {
	if answeredQuestions == 0 {
		return SummaryRecommendation{
			Value:     "insufficient_evidence",
			Label:     "Insufficient evidence",
			Rationale: "No usable candidate answers were captured, so a recruiter should not infer fit from this session.",
		}
	}
	if status != "complete" {
		return SummaryRecommendation{
			Value:     "needs_recruiter_review",
			Label:     "Needs recruiter review",
			Rationale: "The session did not complete, so the recruiter should validate the transcript before deciding the next step.",
		}
	}
	if answeredQuestions < totalQuestions || riskCount > 0 || excludedCount > 0 {
		return SummaryRecommendation{
			Value:     "follow_up_required",
			Label:     "Follow-up required",
			Rationale: "Some planned signals are missing, unclear, or excluded from the recruiter-facing readout.",
		}
	}
	return SummaryRecommendation{
		Value:     "proceed_to_recruiter_review",
		Label:     "Proceed to recruiter review",
		Rationale: "The first-screen transcript contains usable evidence across the planned questions.",
	}
}

func sensitiveRecruiterSignal(text string) (string, bool) {
	normalized := strings.ToLower(text)
	markers := map[string]string{
		"years old":   "age",
		" ans":        "age",
		"pregnant":    "pregnancy or family status",
		"enceinte":    "pregnancy or family status",
		"religion":    "religion",
		"handicap":    "disability or health",
		"disabled":    "disability or health",
		"sante":       "disability or health",
		"santé":       "disability or health",
		"maladie":     "disability or health",
		"marie":       "family status",
		"marié":       "family status",
		"married":     "family status",
		"enfant":      "family status",
		"children":    "family status",
		"nationalite": "nationality or origin",
		"nationalité": "nationality or origin",
		"origine":     "nationality or origin",
	}
	for marker, reason := range markers {
		if strings.Contains(normalized, marker) {
			return reason, true
		}
	}
	return "", false
}

func appendUnique(values []string, next string) []string {
	for _, value := range values {
		if value == next {
			return values
		}
	}
	return append(values, next)
}

func dedupeStrings(values []string) []string {
	unique := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		unique = appendUnique(unique, trimmed)
	}
	return unique
}
