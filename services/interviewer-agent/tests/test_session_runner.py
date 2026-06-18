import pytest
import json
from dataclasses import dataclass, field

from app.adapters.mock_openai_realtime import MockOpenAIRealtimeAdapter
from app.adapters.realtime_api import InMemoryRealtimeApiClient
from app.application.session_runner import InterviewSessionRunner
from app.domain.models import AgentLiveKitJoin, EventActor, EventType, create_demo_plan


@dataclass
class RecordingLiveKitRoom:
    joins: list[AgentLiveKitJoin] = field(default_factory=list)
    disconnects: int = 0

    async def join(self, join: AgentLiveKitJoin) -> None:
        self.joins.append(join)

    async def disconnect(self) -> None:
        self.disconnects += 1


class FailingStartProvider(MockOpenAIRealtimeAdapter):
    async def start_session(self, plan):  # type: ignore[no-untyped-def]
        raise RuntimeError("provider failed before intro")


@pytest.mark.asyncio
async def test_runner_emits_ordered_interview_events() -> None:
    realtime_api = InMemoryRealtimeApiClient()
    runner = InterviewSessionRunner(
        plan=create_demo_plan(),
        provider=MockOpenAIRealtimeAdapter(),
        realtime_api=realtime_api,
        session_id="session-test",
    )

    result = await runner.run()

    assert result.questions_completed == 3
    assert result.events_emitted == len(realtime_api.events)
    assert realtime_api.events[0].type == EventType.SESSION_STARTED
    assert any(event.actor == EventActor.CANDIDATE for event in realtime_api.events)
    assert any(event.actor == EventActor.SYSTEM for event in realtime_api.events)
    assert realtime_api.events[-1].type == EventType.SESSION_COMPLETED
    assert realtime_api.events[-2].type == EventType.SESSION_CLOSING
    assert [event.sequence for event in realtime_api.events] == list(
        range(1, len(realtime_api.events) + 1)
    )
    first_payload = json.loads(realtime_api.events[0].model_dump_json())
    assert first_payload["event_id"].startswith("evt_")
    assert first_payload["idempotency_key"]
    assert realtime_api.events[0].model_dump(by_alias=True)["sequence_number"] == 1
    first_question = next(
        event for event in realtime_api.events if event.type == EventType.QUESTION_ASKED
    )
    assert first_question.payload["question_index"] == 0
    assert first_question.payload["transcript_turn"]["speaker"] == "interviewer"
    assert first_question.payload["transcript_turn"]["text"] == first_question.payload["prompt"]
    assert "question_id" not in realtime_api.events[-2].payload["transcript_turn"]
    assert realtime_api.events[-1].payload["completed_reason"] == "all_questions_completed"
    assert any(event.type == EventType.FOLLOWUP_ASKED for event in realtime_api.events)
    assert any(event.type == EventType.ANSWER_EVALUATED for event in realtime_api.events)
    assert any(event.type == EventType.AGENT_SPEECH_STARTED for event in realtime_api.events)
    assert any(event.type == EventType.AGENT_SPEECH_COMPLETED for event in realtime_api.events)
    assert any(event.type == EventType.CANDIDATE_SPEECH_STARTED for event in realtime_api.events)
    assert any(event.type == EventType.CANDIDATE_TURN_DETECTED for event in realtime_api.events)


@pytest.mark.asyncio
async def test_runner_emits_contract_aligned_session_failed_payload() -> None:
    realtime_api = InMemoryRealtimeApiClient()
    runner = InterviewSessionRunner(
        plan=create_demo_plan(),
        provider=FailingStartProvider(),
        realtime_api=realtime_api,
        session_id="session-test",
    )

    with pytest.raises(RuntimeError):
        await runner.run()

    assert realtime_api.events[-1].type == EventType.SESSION_FAILED
    assert realtime_api.events[-1].payload == {
        "code": "agent_runtime_error",
        "message": "Interview agent failed: RuntimeError",
        "retryable": False,
    }
    assert "error" not in realtime_api.events[-1].payload
    assert "error_type" not in realtime_api.events[-1].payload


@pytest.mark.asyncio
async def test_runner_joins_livekit_room_before_intro_when_join_is_provided() -> None:
    realtime_api = InMemoryRealtimeApiClient()
    livekit_room = RecordingLiveKitRoom()
    join = AgentLiveKitJoin(
        room_name="prelude-session-test",
        url="wss://livekit.example.test",
        token="mock_lk_session-test_agent-session-test",
        participant="agent-session-test",
        expires_at="2026-06-17T10:15:00Z",
    )
    runner = InterviewSessionRunner(
        plan=create_demo_plan(),
        provider=MockOpenAIRealtimeAdapter(),
        realtime_api=realtime_api,
        session_id="session-test",
        livekit_room=livekit_room,
        livekit_join=join,
    )

    await runner.run()

    assert livekit_room.joins == [join]
    assert livekit_room.disconnects == 1
    assert realtime_api.events[0].type == EventType.AGENT_JOINED
    assert realtime_api.events[0].payload == {
        "agent_participant_id": "agent-session-test",
        "provider": "mock",
        "room_name": "prelude-session-test",
    }
    assert realtime_api.events[1].type == EventType.SESSION_STARTED
    assert realtime_api.events[-2].type == EventType.SESSION_CLOSING


@pytest.mark.asyncio
async def test_runner_can_smoke_mocked_candidate_barge_in() -> None:
    realtime_api = InMemoryRealtimeApiClient()
    runner = InterviewSessionRunner(
        plan=create_demo_plan(),
        provider=MockOpenAIRealtimeAdapter(),
        realtime_api=realtime_api,
        session_id="session-test",
        simulate_first_question_barge_in=True,
    )

    await runner.run()

    assert any(event.type == EventType.BARGE_IN_DETECTED for event in realtime_api.events)
    accepted = next(
        event for event in realtime_api.events if event.type == EventType.BARGE_IN_ACCEPTED
    )
    interrupted = next(
        event for event in realtime_api.events if event.type == EventType.AGENT_SPEECH_INTERRUPTED
    )
    assert accepted.actor == EventActor.SYSTEM
    assert interrupted.payload["cancel_agent_audio"] is True
    assert interrupted.payload["cancel_latency_ms"] == 120
