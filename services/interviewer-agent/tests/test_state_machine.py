import pytest

from app.domain.models import EventType
from app.domain.state_machine import (
    InterviewerState,
    InterviewerStateMachine,
    InvalidTransitionError,
)


def test_state_machine_happy_path_with_followup() -> None:
    machine = InterviewerStateMachine()

    assert machine.apply(EventType.SESSION_STARTED) == InterviewerState.INTRO
    assert (
        machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})
        == InterviewerState.ASK_QUESTION
    )
    assert (
        machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
        == InterviewerState.LISTEN
    )
    assert (
        machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})
        == InterviewerState.EVALUATE_ANSWER
    )
    assert (
        machine.apply(
            EventType.ANSWER_EVALUATED,
            {
                "question_id": "q1",
                "classification": "vague",
                "policy_action": "ask_followup",
            },
        )
        == InterviewerState.EVALUATE_ANSWER
    )
    assert (
        machine.apply(EventType.FOLLOWUP_ASKED, {"question_id": "q1"})
        == InterviewerState.SINGLE_FOLLOW_UP
    )
    assert (
        machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
        == InterviewerState.LISTEN
    )
    assert (
        machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})
        == InterviewerState.EVALUATE_ANSWER
    )
    assert (
        machine.apply(
            EventType.ANSWER_EVALUATED,
            {
                "question_id": "q1",
                "classification": "complete",
                "policy_action": "complete_question",
            },
        )
        == InterviewerState.EVALUATE_ANSWER
    )
    assert (
        machine.apply(EventType.QUESTION_COMPLETED, {"question_id": "q1"})
        == InterviewerState.CONFIRM_NEXT
    )
    assert machine.apply(EventType.SESSION_CLOSING) == InterviewerState.CLOSING
    assert machine.apply(EventType.SESSION_COMPLETED) == InterviewerState.ENDED


def test_state_machine_rejects_candidate_turn_before_question() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.CANDIDATE_TURN_STARTED)


def test_state_machine_allows_repeat_without_completing_question() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})

    assert (
        machine.apply(EventType.QUESTION_REPEATED, {"question_id": "q1"})
        == InterviewerState.ASK_QUESTION
    )
    assert machine.completed_question_ids == set()


def test_state_machine_rejects_second_followup_for_same_question() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})
    machine.apply(
        EventType.ANSWER_EVALUATED,
        {
            "question_id": "q1",
            "classification": "vague",
            "policy_action": "ask_followup",
        },
    )
    machine.apply(EventType.FOLLOWUP_ASKED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})
    machine.apply(
        EventType.ANSWER_EVALUATED,
        {
            "question_id": "q1",
            "classification": "vague",
            "policy_action": "ask_followup",
        },
    )

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.FOLLOWUP_ASKED, {"question_id": "q1"})


def test_state_machine_rejects_second_soft_reprompt_for_same_question() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})
    machine.apply(
        EventType.ANSWER_EVALUATED,
        {
            "question_id": "q1",
            "classification": "incomplete",
            "policy_action": "soft_reprompt",
        },
    )
    machine.apply(EventType.SOFT_REPROMPTED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})
    machine.apply(
        EventType.ANSWER_EVALUATED,
        {
            "question_id": "q1",
            "classification": "silent",
            "policy_action": "soft_reprompt",
        },
    )

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.SOFT_REPROMPTED, {"question_id": "q1"})


def test_state_machine_rejects_question_completion_without_answer_evaluation() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_FINALIZED, {"question_id": "q1"})

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.QUESTION_COMPLETED, {"question_id": "q1"})
