from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
import re
import unicodedata

from app.domain.models import (
    CandidateTurn,
    CandidateTurnIntent,
    InterviewPlan,
    InterviewQuestion,
)


EVALUATOR_VERSION = "answer-eval-matrix-v1"


class AnswerClassification(StrEnum):
    COMPLETE = "complete"
    VAGUE = "vague"
    INCOMPLETE = "incomplete"
    SILENT = "silent"
    SKIPPED = "skipped"
    REPEAT_REQUESTED = "repeat_requested"
    WAIT_REQUESTED = "wait_requested"


class PolicyAction(StrEnum):
    COMPLETE_QUESTION = "complete_question"
    ASK_FOLLOWUP = "ask_followup"
    SOFT_REPROMPT = "soft_reprompt"
    REPEAT_QUESTION = "repeat_question"
    WAIT = "wait"
    MARK_SKIPPED = "mark_skipped"
    TIMEBOX = "timebox"


class EvaluationDimension(StrEnum):
    CLARITY = "clarity"
    RELEVANCE = "relevance"
    CONCRETENESS = "concreteness"
    COHERENCE = "coherence"
    ROLE_SIGNAL = "role_signal"


class OrchestratorCommandType(StrEnum):
    ASK_QUESTION = "ask_question"
    REPEAT_QUESTION = "repeat_question"
    SOFT_REPROMPT = "soft_reprompt"
    ASK_FOLLOWUP = "ask_followup"
    COMPLETE_QUESTION = "complete_question"
    CLOSE_SESSION = "close_session"
    FAIL_SESSION = "fail_session"
    WAIT = "wait"


@dataclass(frozen=True)
class EvaluationMatrixDimension:
    name: EvaluationDimension
    score: int
    rationale: str

    def to_payload(self) -> dict[str, object]:
        return {
            "name": self.name.value,
            "score": max(0, min(self.score, 3)),
            "rationale": self.rationale,
        }


@dataclass(frozen=True)
class EvaluationMatrix:
    dimensions: list[EvaluationMatrixDimension]
    challenge_needed: bool
    challenge_reason: str | None = None
    challenge_prompt: str | None = None
    evaluator_mode: str = "heuristic_v1"

    @property
    def overall_score(self) -> int:
        return sum(dimension.score for dimension in self.dimensions)

    @property
    def max_score(self) -> int:
        return len(self.dimensions) * 3

    def dimension_score(self, dimension: EvaluationDimension) -> int:
        for item in self.dimensions:
            if item.name == dimension:
                return item.score
        return 0

    def to_payload(self) -> dict[str, object]:
        return {
            "evaluator_mode": self.evaluator_mode,
            "overall_score": self.overall_score,
            "max_score": self.max_score,
            "dimensions": [dimension.to_payload() for dimension in self.dimensions],
            "challenge": {
                "needed": self.challenge_needed,
                "reason": self.challenge_reason,
                "prompt": self.challenge_prompt,
            },
        }


@dataclass(frozen=True)
class CandidateAnswerAssessment:
    classification: AnswerClassification
    reason_codes: list[str]
    confidence: float
    evaluation_matrix: EvaluationMatrix | None = None


@dataclass(frozen=True)
class AnswerEvaluation:
    question_id: str
    question_index: int
    turn_ids: list[str]
    attempt_index: int
    classification: AnswerClassification
    reason_codes: list[str] = field(default_factory=list)
    policy_action: PolicyAction = PolicyAction.COMPLETE_QUESTION
    confidence: float = 1.0
    evaluator_version: str = EVALUATOR_VERSION
    evaluation_matrix: EvaluationMatrix | None = None

    def to_payload(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "question_id": self.question_id,
            "question_index": self.question_index,
            "turn_ids": self.turn_ids,
            "attempt_index": self.attempt_index,
            "classification": self.classification.value,
            "reason_codes": self.reason_codes,
            "policy_action": self.policy_action.value,
            "confidence": self.confidence,
            "evaluator_version": self.evaluator_version,
        }
        if self.evaluation_matrix is not None:
            payload["evaluation_matrix"] = self.evaluation_matrix.to_payload()
        return payload


@dataclass(frozen=True)
class OrchestratorCommand:
    type: OrchestratorCommandType
    question_id: str | None = None
    question_index: int | None = None
    question: InterviewQuestion | None = None
    completion_reason: str | None = None
    followups_used: int | None = None
    reprompts_used: int | None = None
    attempt_index: int | None = None
    completed_questions: int | None = None
    total_questions: int | None = None
    terminal_reason: str | None = None
    prompt_override: str | None = None


@dataclass(frozen=True)
class OrchestratorDecision:
    answer_evaluation: AnswerEvaluation
    commands: list[OrchestratorCommand]


class InterviewOrchestrator:
    """Deterministic business-policy owner for a structured live interview."""

    def __init__(self, plan: InterviewPlan) -> None:
        self._plan = plan
        self._current_question_index: int | None = None
        self._current_question_id: str | None = None
        self._asked_question_ids: set[str] = set()
        self._completed_question_ids: list[str] = []
        self._followups_by_question: dict[str, int] = {}
        self._reprompts_by_question: dict[str, int] = {}
        self._attempts_by_question: dict[str, int] = {}
        self._terminal_reason: str | None = None

    @property
    def current_question_id(self) -> str | None:
        return self._current_question_id

    @property
    def current_question_index(self) -> int | None:
        return self._current_question_index

    @property
    def terminal_reason(self) -> str | None:
        return self._terminal_reason

    def start(self) -> OrchestratorCommand:
        if self._terminal_reason is not None:
            raise ValueError("Cannot start a terminal interview")
        if self._current_question_id is not None:
            raise ValueError("A question is already active")

        self._current_question_index = 0
        question = self._plan.questions[0]
        self._current_question_id = question.id
        return self._ask_question_command(question, 0)

    def mark_question_asked(self, question_id: str) -> None:
        self._require_active_question(question_id)
        self._asked_question_ids.add(question_id)

    def evaluate_answer(
        self,
        *,
        classification: AnswerClassification,
        turn_ids: list[str],
        reason_codes: list[str] | None = None,
        confidence: float = 1.0,
        evaluation_matrix: EvaluationMatrix | None = None,
    ) -> OrchestratorDecision:
        question_id = self._require_active_question()
        question_index = self._current_question_index
        if question_index is None:
            raise ValueError("No active question index")

        attempt_index = self._attempts_by_question.get(question_id, 0) + 1
        self._attempts_by_question[question_id] = attempt_index

        policy_action, command = self._policy_command(
            question_id=question_id,
            question_index=question_index,
            classification=classification,
            attempt_index=attempt_index,
            evaluation_matrix=evaluation_matrix,
        )
        evaluation = AnswerEvaluation(
            question_id=question_id,
            question_index=question_index,
            turn_ids=turn_ids,
            attempt_index=attempt_index,
            classification=classification,
            reason_codes=reason_codes or [],
            policy_action=policy_action,
            confidence=max(0.0, min(confidence, 1.0)),
            evaluation_matrix=evaluation_matrix,
        )
        return OrchestratorDecision(answer_evaluation=evaluation, commands=[command])

    def mark_question_completed(
        self,
        question_id: str,
        completion_reason: str,
    ) -> OrchestratorCommand:
        self._require_active_question(question_id)
        if question_id not in self._completed_question_ids:
            self._completed_question_ids.append(question_id)

        next_index = len(self._completed_question_ids)
        self._current_question_id = None
        self._current_question_index = None

        if next_index >= len(self._plan.questions):
            self._terminal_reason = "all_questions_completed"
            return OrchestratorCommand(
                type=OrchestratorCommandType.CLOSE_SESSION,
                completed_questions=len(self._completed_question_ids),
                total_questions=len(self._plan.questions),
                terminal_reason=self._terminal_reason,
            )

        self._current_question_index = next_index
        next_question = self._plan.questions[next_index]
        self._current_question_id = next_question.id
        return self._ask_question_command(next_question, next_index)

    def mark_session_closed(self) -> None:
        if self._current_question_id is not None:
            raise ValueError("Cannot close while a question is active")
        if self._terminal_reason is None:
            self._terminal_reason = "all_questions_completed"

    def followups_used(self, question_id: str) -> int:
        return self._followups_by_question.get(question_id, 0)

    def reprompts_used(self, question_id: str) -> int:
        return self._reprompts_by_question.get(question_id, 0)

    @staticmethod
    def classify_candidate_turn(turn: CandidateTurn) -> AnswerClassification:
        if turn.repeat_requested:
            return AnswerClassification.REPEAT_REQUESTED
        if turn.wait_requested:
            return AnswerClassification.WAIT_REQUESTED
        if turn.skip_requested:
            return AnswerClassification.SKIPPED
        if not turn.transcript.strip():
            return AnswerClassification.SILENT
        if turn.candidate_intent == CandidateTurnIntent.ANSWER_PARTIAL:
            return AnswerClassification.VAGUE
        if not turn.is_complete:
            return AnswerClassification.INCOMPLETE
        return AnswerClassification.COMPLETE

    @staticmethod
    def assess_candidate_turn(
        *,
        question: InterviewQuestion,
        turn: CandidateTurn,
        plan: InterviewPlan,
    ) -> CandidateAnswerAssessment:
        deterministic = InterviewOrchestrator.classify_candidate_turn(turn)
        if deterministic != AnswerClassification.COMPLETE:
            return CandidateAnswerAssessment(
                classification=deterministic,
                reason_codes=_base_reason_codes(deterministic, turn),
                confidence=1.0,
            )

        matrix = build_evaluation_matrix(question=question, turn=turn, plan=plan)
        reason_codes = _base_reason_codes(deterministic, turn)
        for dimension in matrix.dimensions:
            if dimension.score < 2:
                reason_codes.append(f"low_{dimension.name.value}")

        if matrix.challenge_needed:
            reason_codes.append(matrix.challenge_reason or "answer_needs_challenge")
            return CandidateAnswerAssessment(
                classification=AnswerClassification.VAGUE,
                reason_codes=_dedupe(reason_codes),
                confidence=_matrix_confidence(matrix),
                evaluation_matrix=matrix,
            )

        if matrix.overall_score < 8:
            reason_codes.append("insufficient_answer_quality")
            return CandidateAnswerAssessment(
                classification=AnswerClassification.INCOMPLETE,
                reason_codes=_dedupe(reason_codes),
                confidence=_matrix_confidence(matrix),
                evaluation_matrix=matrix,
            )

        return CandidateAnswerAssessment(
            classification=AnswerClassification.COMPLETE,
            reason_codes=_dedupe(reason_codes),
            confidence=_matrix_confidence(matrix),
            evaluation_matrix=matrix,
        )

    def _policy_command(
        self,
        *,
        question_id: str,
        question_index: int,
        classification: AnswerClassification,
        attempt_index: int,
        evaluation_matrix: EvaluationMatrix | None,
    ) -> tuple[PolicyAction, OrchestratorCommand]:
        if classification == AnswerClassification.REPEAT_REQUESTED:
            return PolicyAction.REPEAT_QUESTION, OrchestratorCommand(
                type=OrchestratorCommandType.REPEAT_QUESTION,
                question_id=question_id,
                question_index=question_index,
                attempt_index=attempt_index,
            )

        if classification == AnswerClassification.WAIT_REQUESTED:
            return PolicyAction.WAIT, OrchestratorCommand(
                type=OrchestratorCommandType.WAIT,
                question_id=question_id,
                question_index=question_index,
                attempt_index=attempt_index,
            )

        if classification == AnswerClassification.SKIPPED:
            return PolicyAction.MARK_SKIPPED, OrchestratorCommand(
                type=OrchestratorCommandType.COMPLETE_QUESTION,
                question_id=question_id,
                question_index=question_index,
                completion_reason="skipped",
                attempt_index=attempt_index,
            )

        if classification == AnswerClassification.VAGUE and self._can_follow_up(question_id):
            followups_used = self._followups_by_question.get(question_id, 0) + 1
            self._followups_by_question[question_id] = followups_used
            return PolicyAction.ASK_FOLLOWUP, OrchestratorCommand(
                type=OrchestratorCommandType.ASK_FOLLOWUP,
                question_id=question_id,
                question_index=question_index,
                followups_used=followups_used,
                attempt_index=attempt_index,
                prompt_override=(
                    evaluation_matrix.challenge_prompt
                    if evaluation_matrix is not None
                    and evaluation_matrix.challenge_needed
                    else None
                ),
            )

        if classification in {
            AnswerClassification.INCOMPLETE,
            AnswerClassification.SILENT,
        } and self._can_reprompt(question_id):
            reprompts_used = self._reprompts_by_question.get(question_id, 0) + 1
            self._reprompts_by_question[question_id] = reprompts_used
            return PolicyAction.SOFT_REPROMPT, OrchestratorCommand(
                type=OrchestratorCommandType.SOFT_REPROMPT,
                question_id=question_id,
                question_index=question_index,
                reprompts_used=reprompts_used,
                attempt_index=attempt_index,
            )

        if classification in {AnswerClassification.INCOMPLETE, AnswerClassification.SILENT}:
            return PolicyAction.TIMEBOX, OrchestratorCommand(
                type=OrchestratorCommandType.COMPLETE_QUESTION,
                question_id=question_id,
                question_index=question_index,
                completion_reason="candidate_silent",
                attempt_index=attempt_index,
            )

        return PolicyAction.COMPLETE_QUESTION, OrchestratorCommand(
            type=OrchestratorCommandType.COMPLETE_QUESTION,
            question_id=question_id,
            question_index=question_index,
            completion_reason="answered",
            attempt_index=attempt_index,
        )

    def _can_follow_up(self, question_id: str) -> bool:
        max_followups = min(self._plan.max_followups_per_question, 1)
        return self._followups_by_question.get(question_id, 0) < max_followups

    def _can_reprompt(self, question_id: str) -> bool:
        return self._reprompts_by_question.get(question_id, 0) < 1

    def _ask_question_command(
        self,
        question: InterviewQuestion,
        question_index: int,
    ) -> OrchestratorCommand:
        return OrchestratorCommand(
            type=OrchestratorCommandType.ASK_QUESTION,
            question_id=question.id,
            question_index=question_index,
            question=question,
        )

    def _require_active_question(self, question_id: str | None = None) -> str:
        if self._terminal_reason is not None and self._current_question_id is None:
            raise ValueError("Interview is terminal")
        if self._current_question_id is None:
            raise ValueError("No active question")
        if question_id is not None and self._current_question_id != question_id:
            raise ValueError(
                f"Expected active question {self._current_question_id}, got {question_id}"
            )
        return self._current_question_id


STOPWORDS = {
    "a",
    "au",
    "aux",
    "avec",
    "ce",
    "ces",
    "cette",
    "de",
    "des",
    "du",
    "en",
    "et",
    "for",
    "i",
    "il",
    "in",
    "is",
    "je",
    "la",
    "le",
    "les",
    "me",
    "mon",
    "nous",
    "of",
    "on",
    "or",
    "pour",
    "que",
    "qui",
    "the",
    "to",
    "un",
    "une",
    "vous",
}

NONSENSE_MARKERS = {
    "asdf",
    "blah",
    "bla bla",
    "caca",
    "poop",
    "prout",
    "n'importe quoi",
    "random",
}

LOW_INFORMATION_MARKERS = {
    "aucune idee",
    "aucune idée",
    "je ne sais pas",
    "j'en sais rien",
    "pas grand chose",
    "rien a dire",
    "rien à dire",
}

CONCRETE_MARKERS = {
    "exemple",
    "resultat",
    "résultat",
    "impact",
    "client",
    "contrainte",
    "decision",
    "décision",
    "priorise",
    "priorisé",
    "mesure",
    "churn",
    "roadmap",
    "stakeholder",
    "equipe",
    "équipe",
    "j'ai",
    "nous avons",
}

CATEGORY_SIGNAL_TOKENS = {
    "experience": {
        "client",
        "customer",
        "incident",
        "support",
        "priorise",
        "priorite",
        "priorité",
        "coordonne",
        "coordonné",
        "resultat",
        "résultat",
    },
    "motivation": {
        "interesse",
        "intéresse",
        "motivation",
        "poste",
        "role",
        "rôle",
        "equipe",
        "équipe",
        "produit",
    },
    "logistics": {
        "disponible",
        "disponibilite",
        "disponibilites",
        "availability",
        "remote",
        "hybride",
        "contrainte",
    },
    "role_fit": {
        "client",
        "customer",
        "incident",
        "support",
        "priorise",
        "priorite",
        "coordonne",
        "resultat",
        "impact",
        "equipe",
        "team",
    },
}


def build_evaluation_matrix(
    *,
    question: InterviewQuestion,
    turn: CandidateTurn,
    plan: InterviewPlan,
) -> EvaluationMatrix:
    normalized_answer = _normalize_text(turn.transcript)
    answer_tokens = _keywords(normalized_answer)
    question_tokens = _keywords(question.prompt)
    role_tokens = _keywords(plan.role_title)
    constraint_tokens = _keywords(" ".join(plan.interview_style.role_constraints))
    overlap = answer_tokens & (question_tokens | role_tokens | constraint_tokens)

    clarity = _score_clarity(normalized_answer, answer_tokens)
    relevance = _score_relevance(
        normalized_answer=normalized_answer,
        answer_tokens=answer_tokens,
        overlap=overlap,
        question=question,
    )
    concreteness = _score_concreteness(normalized_answer, answer_tokens)
    coherence = _score_coherence(normalized_answer, answer_tokens)
    role_signal = _score_role_signal(
        answer_tokens=answer_tokens,
        role_tokens=role_tokens,
        constraint_tokens=constraint_tokens,
        category=question.category.value,
    )

    dimensions = [
        EvaluationMatrixDimension(
            EvaluationDimension.CLARITY,
            clarity,
            _rationale("clarity", clarity),
        ),
        EvaluationMatrixDimension(
            EvaluationDimension.RELEVANCE,
            relevance,
            _rationale("relevance", relevance),
        ),
        EvaluationMatrixDimension(
            EvaluationDimension.CONCRETENESS,
            concreteness,
            _rationale("concreteness", concreteness),
        ),
        EvaluationMatrixDimension(
            EvaluationDimension.COHERENCE,
            coherence,
            _rationale("coherence", coherence),
        ),
        EvaluationMatrixDimension(
            EvaluationDimension.ROLE_SIGNAL,
            role_signal,
            _rationale("role signal", role_signal),
        ),
    ]
    preliminary = EvaluationMatrix(dimensions=dimensions, challenge_needed=False)
    challenge_reason = _challenge_reason(preliminary, question.category.value)
    return EvaluationMatrix(
        dimensions=dimensions,
        challenge_needed=challenge_reason is not None,
        challenge_reason=challenge_reason,
        challenge_prompt=(
            _challenge_prompt(question, challenge_reason)
            if challenge_reason is not None
            else None
        ),
    )


def _score_clarity(normalized_answer: str, answer_tokens: set[str]) -> int:
    if not normalized_answer:
        return 0
    if len(answer_tokens) <= 2:
        return 1
    if len(answer_tokens) <= 6:
        return 2
    return 3


def _score_relevance(
    *,
    normalized_answer: str,
    answer_tokens: set[str],
    overlap: set[str],
    question: InterviewQuestion,
) -> int:
    if _contains_marker(normalized_answer, NONSENSE_MARKERS):
        return 0
    if _contains_marker(normalized_answer, LOW_INFORMATION_MARKERS):
        return 1
    if len(overlap) >= 2:
        return 3
    if len(overlap) == 1:
        return 2
    category_tokens = CATEGORY_SIGNAL_TOKENS.get(question.category.value, set())
    if len(answer_tokens & category_tokens) >= 2:
        return 3
    if len(answer_tokens & category_tokens) == 1:
        return 2
    if question.category.value in answer_tokens:
        return 2
    return 1 if len(answer_tokens) >= 5 else 0


def _score_concreteness(normalized_answer: str, answer_tokens: set[str]) -> int:
    marker_hits = sum(1 for marker in CONCRETE_MARKERS if marker in normalized_answer)
    has_number = bool(re.search(r"\d", normalized_answer))
    if marker_hits >= 2 or (marker_hits >= 1 and has_number):
        return 3
    if marker_hits == 1 or has_number:
        return 2
    if len(answer_tokens) >= 10:
        return 1
    return 0


def _score_coherence(normalized_answer: str, answer_tokens: set[str]) -> int:
    if _contains_marker(normalized_answer, NONSENSE_MARKERS):
        return 0
    if len(answer_tokens) <= 2:
        return 1
    repeated_tokens = [token for token in answer_tokens if normalized_answer.count(token) >= 4]
    if repeated_tokens:
        return 1
    if _contains_marker(normalized_answer, LOW_INFORMATION_MARKERS):
        return 2
    return 3


def _score_role_signal(
    *,
    answer_tokens: set[str],
    role_tokens: set[str],
    constraint_tokens: set[str],
    category: str,
) -> int:
    signal_tokens = answer_tokens & (role_tokens | constraint_tokens)
    if len(signal_tokens) >= 2:
        return 3
    if len(signal_tokens) == 1:
        return 2
    if category in {"logistics", "availability"} and {
        "disponibilite",
        "disponibilites",
        "disponible",
        "availability",
        "remote",
        "hybride",
    } & answer_tokens:
        return 3
    return 1 if len(answer_tokens) >= 8 else 0


def _challenge_reason(matrix: EvaluationMatrix, category: str) -> str | None:
    if matrix.dimension_score(EvaluationDimension.COHERENCE) == 0:
        return "incoherent_or_absurd_answer"
    if matrix.dimension_score(EvaluationDimension.RELEVANCE) <= 1:
        return "off_topic_or_low_relevance"
    if (
        category not in {"logistics", "availability"}
        and matrix.dimension_score(EvaluationDimension.CONCRETENESS) <= 1
    ):
        return "missing_concrete_example"
    if (
        matrix.dimension_score(EvaluationDimension.ROLE_SIGNAL) <= 1
        and matrix.overall_score < 10
    ):
        return "weak_role_signal"
    return None


def _challenge_prompt(question: InterviewQuestion, reason: str) -> str:
    if reason == "incoherent_or_absurd_answer":
        return (
            "Je vais vous recentrer sur la question : votre reponse ne me permet pas "
            "d'evaluer le signal attendu. Pouvez-vous repondre avec un exemple concret ?"
        )
    if reason == "off_topic_or_low_relevance":
        return (
            "Je veux etre sur de bien evaluer ce point. Pouvez-vous repondre "
            f"directement a la question : {question.prompt}"
        )
    if reason == "missing_concrete_example":
        return (
            "Pouvez-vous me donner un exemple concret, avec le contexte, votre action "
            "et le resultat obtenu ?"
        )
    return (
        "Pouvez-vous relier votre reponse au poste et donner un element concret "
        "que le recruteur pourra verifier ?"
    )


def _rationale(label: str, score: int) -> str:
    if score == 3:
        return f"Strong {label} signal."
    if score == 2:
        return f"Usable but partial {label} signal."
    if score == 1:
        return f"Weak {label} signal."
    return f"No usable {label} signal."


def _matrix_confidence(matrix: EvaluationMatrix) -> float:
    return round(max(0.15, min(0.95, matrix.overall_score / matrix.max_score)), 2)


def _base_reason_codes(
    classification: AnswerClassification,
    turn: CandidateTurn | None = None,
) -> list[str]:
    reason_codes: list[str] = []
    if turn is not None:
        reason_codes.append(f"candidate_intent:{turn.candidate_intent.value}")
        if turn.classifier_reason:
            reason_codes.append(turn.classifier_reason)
    if classification == AnswerClassification.VAGUE:
        reason_codes.append("too_generic")
    elif classification == AnswerClassification.INCOMPLETE:
        reason_codes.append("incomplete_answer")
    elif classification == AnswerClassification.SILENT:
        reason_codes.append("candidate_silent")
    elif classification == AnswerClassification.SKIPPED:
        reason_codes.append("candidate_requested_skip")
    elif classification == AnswerClassification.REPEAT_REQUESTED:
        reason_codes.append("candidate_requested_repeat")
    elif classification == AnswerClassification.WAIT_REQUESTED:
        reason_codes.append("candidate_requested_time")
    return _dedupe(reason_codes)


def _keywords(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9']{3,}", _normalize_text(text))
        if token not in STOPWORDS
    }


def _normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.lower())
    without_accents = "".join(
        char for char in normalized if not unicodedata.combining(char)
    )
    return re.sub(r"\s+", " ", without_accents).strip()


def _contains_marker(text: str, markers: set[str]) -> bool:
    return any(marker in text for marker in markers)


def _dedupe(values: list[str]) -> list[str]:
    unique: list[str] = []
    for value in values:
        if value and value not in unique:
            unique.append(value)
    return unique
