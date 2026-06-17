from __future__ import annotations

from enum import StrEnum

from app.domain.models import EventType


class InterviewerState(StrEnum):
    CREATED = "created"
    INTRODUCING = "introducing"
    ASKING = "asking"
    LISTENING = "listening"
    THINKING = "thinking"
    FOLLOWING_UP = "following_up"
    COMPLETED = "completed"
    FAILED = "failed"


class InvalidTransitionError(ValueError):
    pass


class InterviewerStateMachine:
    """Small state machine that guards the interviewer behavior contract."""

    _TRANSITIONS: dict[InterviewerState, dict[EventType, InterviewerState]] = {
        InterviewerState.CREATED: {
            EventType.SESSION_STARTED: InterviewerState.INTRODUCING,
            EventType.SESSION_FAILED: InterviewerState.FAILED,
        },
        InterviewerState.INTRODUCING: {
            EventType.QUESTION_ASKED: InterviewerState.ASKING,
            EventType.SESSION_COMPLETED: InterviewerState.COMPLETED,
            EventType.SESSION_FAILED: InterviewerState.FAILED,
        },
        InterviewerState.ASKING: {
            EventType.QUESTION_REPEATED: InterviewerState.ASKING,
            EventType.CANDIDATE_TURN_STARTED: InterviewerState.LISTENING,
            EventType.SESSION_FAILED: InterviewerState.FAILED,
        },
        InterviewerState.LISTENING: {
            EventType.CANDIDATE_TURN_FINALIZED: InterviewerState.THINKING,
            EventType.SESSION_FAILED: InterviewerState.FAILED,
        },
        InterviewerState.THINKING: {
            EventType.FOLLOWUP_ASKED: InterviewerState.FOLLOWING_UP,
            EventType.QUESTION_COMPLETED: InterviewerState.INTRODUCING,
            EventType.SESSION_COMPLETED: InterviewerState.COMPLETED,
            EventType.SESSION_FAILED: InterviewerState.FAILED,
        },
        InterviewerState.FOLLOWING_UP: {
            EventType.QUESTION_REPEATED: InterviewerState.FOLLOWING_UP,
            EventType.CANDIDATE_TURN_STARTED: InterviewerState.LISTENING,
            EventType.SESSION_FAILED: InterviewerState.FAILED,
        },
        InterviewerState.COMPLETED: {},
        InterviewerState.FAILED: {},
    }

    def __init__(self) -> None:
        self.state = InterviewerState.CREATED

    def apply(self, event_type: EventType) -> InterviewerState:
        next_state = self._TRANSITIONS[self.state].get(event_type)
        if next_state is None:
            raise InvalidTransitionError(
                f"Cannot apply {event_type.value} while interviewer is {self.state.value}"
            )

        self.state = next_state
        return self.state
