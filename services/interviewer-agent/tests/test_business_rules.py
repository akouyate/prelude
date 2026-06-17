import pytest

from app.adapters.realtime_api import InMemoryRealtimeApiClient
from app.application.session_runner import InterviewSessionRunner
from app.domain.models import (
    CandidateTurn,
    EventType,
    InterviewPlan,
    InterviewQuestion,
    QuestionCategory,
)
from app.domain.state_machine import (
    InterviewerState,
    InterviewerStateMachine,
    InvalidTransitionError,
)


class PushyProvider:
    async def start_session(self, plan: InterviewPlan) -> str:
        return "Intro"

    async def ask_question(self, question: InterviewQuestion) -> str:
        return question.prompt

    async def listen_for_answer(self, question: InterviewQuestion) -> CandidateTurn:
        return CandidateTurn(question_id=question.id, transcript="Too short")

    async def should_follow_up(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
        followups_used: int,
        max_followups: int,
    ) -> bool:
        return followups_used < 5

    async def ask_follow_up(self, question: InterviewQuestion) -> str:
        return question.follow_up_prompt or "Can you clarify?"

    async def close_session(self) -> str:
        return "Closing"


def one_question_plan() -> InterviewPlan:
    return InterviewPlan(
        id="plan-test",
        role_title="Backend Engineer",
        max_followups_per_question=1,
        questions=[
            InterviewQuestion(
                id="q1",
                prompt="Tell me about a production incident you handled.",
                category=QuestionCategory.EXPERIENCE,
                follow_up_prompt="What did you change afterward?",
            )
        ],
    )


def test_one_question_at_a_time_is_enforced() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED)

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.QUESTION_ASKED)


def test_repeat_question_keeps_current_question_open() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED)

    assert machine.apply(EventType.QUESTION_REPEATED) == InterviewerState.ASKING
    assert machine.apply(EventType.CANDIDATE_TURN_STARTED) == InterviewerState.LISTENING


def test_free_chat_is_rejected() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED)

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.FREE_CHAT_REQUESTED)


@pytest.mark.asyncio
async def test_runner_enforces_single_follow_up_even_if_provider_requests_more() -> None:
    realtime_api = InMemoryRealtimeApiClient(print_events=False)
    runner = InterviewSessionRunner(
        plan=one_question_plan(),
        provider=PushyProvider(),
        realtime_api=realtime_api,
        session_id="session-followup-cap",
    )

    await runner.run()

    followup_events = [
        event for event in realtime_api.events if event.type == EventType.FOLLOWUP_ASKED
    ]
    assert len(followup_events) == 1
    completed_events = [
        event for event in realtime_api.events if event.type == EventType.QUESTION_COMPLETED
    ]
    assert completed_events[0].payload["completion_reason"] == "answered"


@pytest.mark.asyncio
async def test_runner_emits_events_in_question_lifecycle_order() -> None:
    realtime_api = InMemoryRealtimeApiClient(print_events=False)
    runner = InterviewSessionRunner(
        plan=one_question_plan(),
        provider=PushyProvider(),
        realtime_api=realtime_api,
        session_id="session-event-order",
    )

    await runner.run()

    assert [event.type for event in realtime_api.events] == [
        EventType.SESSION_STARTED,
        EventType.QUESTION_ASKED,
        EventType.CANDIDATE_TURN_STARTED,
        EventType.CANDIDATE_TURN_FINALIZED,
        EventType.FOLLOWUP_ASKED,
        EventType.CANDIDATE_TURN_STARTED,
        EventType.CANDIDATE_TURN_FINALIZED,
        EventType.QUESTION_COMPLETED,
        EventType.SESSION_COMPLETED,
    ]
