import pytest
import json

from app.adapters.mock_openai_realtime import MockOpenAIRealtimeAdapter
from app.adapters.realtime_api import InMemoryRealtimeApiClient
from app.application.session_runner import InterviewSessionRunner
from app.domain.models import EventType, create_demo_plan


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
    assert realtime_api.events[-1].type == EventType.SESSION_COMPLETED
    assert [event.sequence for event in realtime_api.events] == list(
        range(1, len(realtime_api.events) + 1)
    )
    first_payload = json.loads(realtime_api.events[0].model_dump_json())
    assert first_payload["event_id"].startswith("evt_")
    assert first_payload["idempotency_key"]
    assert first_payload["sequence"] == 1
    assert realtime_api.events[1].payload["question_index"] == 0
    assert realtime_api.events[-1].payload["completed_reason"] == "all_questions_completed"
    assert any(event.type == EventType.FOLLOWUP_ASKED for event in realtime_api.events)
