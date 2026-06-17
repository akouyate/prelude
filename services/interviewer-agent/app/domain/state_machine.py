from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from app.domain.models import EventType


INTERVIEWER_STATE_MACHINE_INSTRUCTIONS = """
You are a structured first-screening interviewer, not an open chatbot.
Follow the interview plan in order. Ask one planned question at a time.
Repeat the current question only when the candidate asks. Use at most one
soft reprompt for silence, unclear, or incomplete answers. Use at most one
configured follow-up for the current question. Do not ask extra questions,
do not make hiring decisions, and do not discuss topics outside the plan.
Move to the next planned question only after the current answer is answered
or skipped.
""".strip()


class InterviewerState(StrEnum):
    CREATED = "created"
    JOINED = "joined"
    INTRO = "intro"
    ASK_QUESTION = "ask_question"
    LISTEN = "listen"
    EVALUATE_ANSWER = "evaluate_answer"
    SOFT_REPROMPT = "soft_reprompt"
    SINGLE_FOLLOW_UP = "single_follow_up"
    CONFIRM_NEXT = "confirm_next"
    CLOSING = "closing"
    ENDED = "ended"
    FAILED = "failed"


class InvalidTransitionError(ValueError):
    pass


class InterviewerStateMachine:
    """Interview policy guardrail that keeps the IA interviewer structured."""

    def __init__(self) -> None:
        self.state = InterviewerState.CREATED
        self.current_question_id: str | None = None
        self.completed_question_ids: set[str] = set()
        self.followups_by_question: dict[str, int] = {}
        self.reprompts_by_question: dict[str, int] = {}

    def apply(
        self,
        event_type: EventType,
        payload: Mapping[str, Any] | None = None,
    ) -> InterviewerState:
        payload = payload or {}

        if self.state in {InterviewerState.ENDED, InterviewerState.FAILED}:
            raise InvalidTransitionError(
                f"Cannot apply {event_type.value} while interviewer is {self.state.value}"
            )
        if event_type == EventType.FREE_CHAT_REQUESTED:
            raise InvalidTransitionError("Free chat is outside the structured interview plan")
        if event_type == EventType.SESSION_FAILED:
            self.state = InterviewerState.FAILED
            return self.state

        handlers = {
            EventType.AGENT_JOINED: self._apply_agent_joined,
            EventType.SESSION_STARTED: self._apply_session_started,
            EventType.QUESTION_ASKED: self._apply_question_asked,
            EventType.CANDIDATE_TURN_STARTED: self._apply_candidate_turn_started,
            EventType.QUESTION_REPEATED: self._apply_question_repeated,
            EventType.CANDIDATE_TURN_FINALIZED: self._apply_candidate_turn_finalized,
            EventType.SOFT_REPROMPTED: self._apply_soft_reprompted,
            EventType.FOLLOWUP_ASKED: self._apply_followup_asked,
            EventType.QUESTION_COMPLETED: self._apply_question_completed,
            EventType.SESSION_CLOSING: self._apply_session_closing,
            EventType.SESSION_COMPLETED: self._apply_session_completed,
        }
        handler = handlers.get(event_type)
        if handler is None:
            raise InvalidTransitionError(f"Unsupported interviewer event {event_type.value}")

        return handler(payload)

    def _apply_agent_joined(self, _payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.AGENT_JOINED, {InterviewerState.CREATED})
        self.state = InterviewerState.JOINED
        return self.state

    def _apply_session_started(self, _payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(
            EventType.SESSION_STARTED,
            {InterviewerState.CREATED, InterviewerState.JOINED},
        )
        self.state = InterviewerState.INTRO
        return self.state

    def _apply_question_asked(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(
            EventType.QUESTION_ASKED,
            {InterviewerState.INTRO, InterviewerState.CONFIRM_NEXT},
        )
        question_id = self._question_id(payload, EventType.QUESTION_ASKED)
        if question_id in self.completed_question_ids:
            raise InvalidTransitionError(f"Question {question_id} is already completed")

        self.current_question_id = question_id
        self.state = InterviewerState.ASK_QUESTION
        return self.state

    def _apply_candidate_turn_started(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(
            EventType.CANDIDATE_TURN_STARTED,
            {
                InterviewerState.ASK_QUESTION,
                InterviewerState.SOFT_REPROMPT,
                InterviewerState.SINGLE_FOLLOW_UP,
            },
        )
        self._require_current_question(payload, EventType.CANDIDATE_TURN_STARTED)
        self.state = InterviewerState.LISTEN
        return self.state

    def _apply_question_repeated(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.QUESTION_REPEATED, {InterviewerState.LISTEN})
        self._require_current_question(payload, EventType.QUESTION_REPEATED)
        self.state = InterviewerState.ASK_QUESTION
        return self.state

    def _apply_candidate_turn_finalized(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.CANDIDATE_TURN_FINALIZED, {InterviewerState.LISTEN})
        self._require_current_question(payload, EventType.CANDIDATE_TURN_FINALIZED)
        self.state = InterviewerState.EVALUATE_ANSWER
        return self.state

    def _apply_soft_reprompted(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.SOFT_REPROMPTED, {InterviewerState.EVALUATE_ANSWER})
        question_id = self._require_current_question(payload, EventType.SOFT_REPROMPTED)
        reprompts_used = self.reprompts_by_question.get(question_id, 0)
        if reprompts_used >= 1:
            raise InvalidTransitionError(f"Question {question_id} already used a soft reprompt")

        self.reprompts_by_question[question_id] = reprompts_used + 1
        self.state = InterviewerState.SOFT_REPROMPT
        return self.state

    def _apply_followup_asked(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.FOLLOWUP_ASKED, {InterviewerState.EVALUATE_ANSWER})
        question_id = self._require_current_question(payload, EventType.FOLLOWUP_ASKED)
        followups_used = self.followups_by_question.get(question_id, 0)
        if followups_used >= 1:
            raise InvalidTransitionError(f"Question {question_id} already used a follow-up")

        self.followups_by_question[question_id] = followups_used + 1
        self.state = InterviewerState.SINGLE_FOLLOW_UP
        return self.state

    def _apply_question_completed(self, payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.QUESTION_COMPLETED, {InterviewerState.EVALUATE_ANSWER})
        question_id = self._require_current_question(payload, EventType.QUESTION_COMPLETED)
        self.completed_question_ids.add(question_id)
        self.current_question_id = None
        self.state = InterviewerState.CONFIRM_NEXT
        return self.state

    def _apply_session_closing(self, _payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(
            EventType.SESSION_CLOSING,
            {InterviewerState.INTRO, InterviewerState.CONFIRM_NEXT},
        )
        if self.current_question_id is not None:
            raise InvalidTransitionError("Cannot close while a question is active")

        self.state = InterviewerState.CLOSING
        return self.state

    def _apply_session_completed(self, _payload: Mapping[str, Any]) -> InterviewerState:
        self._require_state(EventType.SESSION_COMPLETED, {InterviewerState.CLOSING})
        self.state = InterviewerState.ENDED
        return self.state

    def _require_state(
        self,
        event_type: EventType,
        allowed_states: set[InterviewerState],
    ) -> None:
        if self.state not in allowed_states:
            allowed = ", ".join(sorted(state.value for state in allowed_states))
            raise InvalidTransitionError(
                f"Cannot apply {event_type.value} while interviewer is {self.state.value}; "
                f"expected one of: {allowed}"
            )

    def _question_id(self, payload: Mapping[str, Any], event_type: EventType) -> str:
        question_id = payload.get("question_id")
        if not isinstance(question_id, str) or not question_id.strip():
            raise InvalidTransitionError(f"{event_type.value} requires question_id")

        return question_id

    def _require_current_question(
        self,
        payload: Mapping[str, Any],
        event_type: EventType,
    ) -> str:
        question_id = self._question_id(payload, event_type)
        if self.current_question_id != question_id:
            raise InvalidTransitionError(
                f"{event_type.value} targets {question_id}, "
                f"but current question is {self.current_question_id}"
            )

        return question_id
