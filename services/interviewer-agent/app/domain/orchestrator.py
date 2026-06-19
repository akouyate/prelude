from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.models import (
    CandidateTurn,
    CandidateTurnIntent,
    InterviewPlan,
    InterviewQuestion,
)


EVALUATOR_VERSION = "answer-eval-v1"


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

    def to_payload(self) -> dict[str, object]:
        return {
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

    def _policy_command(
        self,
        *,
        question_id: str,
        question_index: int,
        classification: AnswerClassification,
        attempt_index: int,
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
