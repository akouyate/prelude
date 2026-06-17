import pytest

from app.domain.models import EventType
from app.domain.state_machine import (
    InterviewerState,
    InterviewerStateMachine,
    InvalidTransitionError,
)


def test_state_machine_happy_path_with_followup() -> None:
    machine = InterviewerStateMachine()

    assert machine.apply(EventType.SESSION_STARTED) == InterviewerState.INTRODUCING
    assert machine.apply(EventType.QUESTION_ASKED) == InterviewerState.ASKING
    assert machine.apply(EventType.CANDIDATE_TURN_STARTED) == InterviewerState.LISTENING
    assert machine.apply(EventType.CANDIDATE_TURN_FINALIZED) == InterviewerState.THINKING
    assert machine.apply(EventType.FOLLOWUP_ASKED) == InterviewerState.FOLLOWING_UP
    assert machine.apply(EventType.CANDIDATE_TURN_STARTED) == InterviewerState.LISTENING
    assert machine.apply(EventType.CANDIDATE_TURN_FINALIZED) == InterviewerState.THINKING
    assert machine.apply(EventType.QUESTION_COMPLETED) == InterviewerState.INTRODUCING
    assert machine.apply(EventType.SESSION_COMPLETED) == InterviewerState.COMPLETED


def test_state_machine_rejects_candidate_turn_before_question() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.CANDIDATE_TURN_STARTED)

