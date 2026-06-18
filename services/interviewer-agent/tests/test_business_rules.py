import pytest

from app.adapters.realtime_api import InMemoryRealtimeApiClient
from app.adapters.mock_openai_realtime import MockOpenAIRealtimeAdapter
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


class ScriptedProvider(PushyProvider):
    def __init__(self, turns: list[CandidateTurn]) -> None:
        self._turns = turns

    async def listen_for_answer(self, question: InterviewQuestion) -> CandidateTurn:
        if not self._turns:
            return CandidateTurn(question_id=question.id, transcript="Final answer")
        return self._turns.pop(0)

    async def should_follow_up(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
        followups_used: int,
        max_followups: int,
    ) -> bool:
        return False


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
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.QUESTION_ASKED, {"question_id": "q2"})


def test_repeat_question_keeps_current_question_open() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})
    machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})

    assert (
        machine.apply(EventType.QUESTION_REPEATED, {"question_id": "q1"})
        == InterviewerState.ASK_QUESTION
    )
    assert (
        machine.apply(EventType.CANDIDATE_TURN_STARTED, {"question_id": "q1"})
        == InterviewerState.LISTEN
    )


def test_free_chat_is_rejected() -> None:
    machine = InterviewerStateMachine()
    machine.apply(EventType.SESSION_STARTED)
    machine.apply(EventType.QUESTION_ASKED, {"question_id": "q1"})

    with pytest.raises(InvalidTransitionError):
        machine.apply(EventType.FREE_CHAT_REQUESTED)


def test_mock_provider_instructions_reference_state_machine_rules() -> None:
    provider = MockOpenAIRealtimeAdapter()

    assert "structured first-screening interviewer" in provider.system_instructions
    assert "Do not ask extra questions" in provider.system_instructions
    assert "configured follow-up" in provider.system_instructions.lower()


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

    business_events = [
        event.type
        for event in realtime_api.events
        if event.type
        in {
            EventType.SESSION_STARTED,
            EventType.QUESTION_ASKED,
            EventType.CANDIDATE_TURN_STARTED,
            EventType.CANDIDATE_TURN_FINALIZED,
            EventType.ANSWER_EVALUATED,
            EventType.FOLLOWUP_ASKED,
            EventType.QUESTION_COMPLETED,
            EventType.SESSION_CLOSING,
            EventType.SESSION_COMPLETED,
        }
    ]
    assert business_events == [
        EventType.SESSION_STARTED,
        EventType.QUESTION_ASKED,
        EventType.CANDIDATE_TURN_STARTED,
        EventType.CANDIDATE_TURN_FINALIZED,
        EventType.ANSWER_EVALUATED,
        EventType.FOLLOWUP_ASKED,
        EventType.CANDIDATE_TURN_STARTED,
        EventType.CANDIDATE_TURN_FINALIZED,
        EventType.ANSWER_EVALUATED,
        EventType.QUESTION_COMPLETED,
        EventType.SESSION_CLOSING,
        EventType.SESSION_COMPLETED,
    ]
    assert EventType.AGENT_SPEECH_STARTED in [event.type for event in realtime_api.events]
    assert EventType.CANDIDATE_TURN_DETECTED in [event.type for event in realtime_api.events]


@pytest.mark.asyncio
async def test_runner_repeats_question_when_candidate_requests_repeat() -> None:
    realtime_api = InMemoryRealtimeApiClient(print_events=False)
    runner = InterviewSessionRunner(
        plan=one_question_plan(),
        provider=ScriptedProvider(
            [
                CandidateTurn(
                    question_id="q1",
                    transcript="Pouvez-vous repeter ?",
                    repeat_requested=True,
                ),
                CandidateTurn(question_id="q1", transcript="Here is my answer"),
            ]
        ),
        realtime_api=realtime_api,
        session_id="session-repeat",
    )

    await runner.run()

    assert [event.type for event in realtime_api.events].count(EventType.QUESTION_REPEATED) == 1
    assert [event.type for event in realtime_api.events].count(EventType.QUESTION_COMPLETED) == 1


@pytest.mark.asyncio
async def test_runner_soft_reprompts_once_for_incomplete_answer() -> None:
    realtime_api = InMemoryRealtimeApiClient(print_events=False)
    runner = InterviewSessionRunner(
        plan=one_question_plan(),
        provider=ScriptedProvider(
            [
                CandidateTurn(
                    question_id="q1",
                    transcript="I guess",
                    is_complete=False,
                ),
                CandidateTurn(question_id="q1", transcript="Here is a complete answer"),
            ]
        ),
        realtime_api=realtime_api,
        session_id="session-soft-reprompt",
    )

    await runner.run()

    assert [event.type for event in realtime_api.events].count(EventType.SOFT_REPROMPTED) == 1
    finalized = [
        event
        for event in realtime_api.events
        if event.type == EventType.CANDIDATE_TURN_FINALIZED
    ]
    assert finalized[0].payload["completion_reason"] == "incomplete"
    assert finalized[-1].payload["completion_reason"] == "answered"


@pytest.mark.asyncio
async def test_runner_completes_question_as_skipped_when_candidate_skips() -> None:
    realtime_api = InMemoryRealtimeApiClient(print_events=False)
    runner = InterviewSessionRunner(
        plan=one_question_plan(),
        provider=ScriptedProvider(
            [
                CandidateTurn(
                    question_id="q1",
                    transcript="I prefer to skip this one",
                    skip_requested=True,
                )
            ]
        ),
        realtime_api=realtime_api,
        session_id="session-skip",
    )

    await runner.run()

    completed = [
        event for event in realtime_api.events if event.type == EventType.QUESTION_COMPLETED
    ]
    assert completed[0].payload["completion_reason"] == "skipped"
    evaluated = [
        event for event in realtime_api.events if event.type == EventType.ANSWER_EVALUATED
    ]
    assert evaluated[0].payload["classification"] == "skipped"
    assert evaluated[0].payload["policy_action"] == "mark_skipped"


@pytest.mark.asyncio
async def test_runner_wait_keeps_current_question_active_without_followup() -> None:
    realtime_api = InMemoryRealtimeApiClient(print_events=False)
    runner = InterviewSessionRunner(
        plan=one_question_plan(),
        provider=ScriptedProvider(
            [
                CandidateTurn(
                    question_id="q1",
                    transcript="J'ai besoin d'une seconde.",
                    wait_requested=True,
                ),
                CandidateTurn(question_id="q1", transcript="Here is my answer"),
            ]
        ),
        realtime_api=realtime_api,
        session_id="session-wait",
    )

    await runner.run()

    assert [event.type for event in realtime_api.events].count(EventType.WAIT_REQUESTED) == 1
    assert [event.type for event in realtime_api.events].count(EventType.FOLLOWUP_ASKED) == 0
    evaluated = [
        event for event in realtime_api.events if event.type == EventType.ANSWER_EVALUATED
    ]
    assert evaluated[0].payload["classification"] == "wait_requested"
    assert evaluated[0].payload["policy_action"] == "wait"
    completed = [
        event for event in realtime_api.events if event.type == EventType.QUESTION_COMPLETED
    ]
    assert completed[0].payload["completion_reason"] == "answered"
