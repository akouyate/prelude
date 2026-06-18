import httpx
import pytest

from app.adapters.realtime_api import HttpRealtimeApiClient
from app.domain.models import EventType


@pytest.mark.asyncio
async def test_http_realtime_client_loads_agent_config() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/v1/interview-sessions/session-test/agent-config"
        return httpx.Response(
            200,
            json={
                "session": {
                    "id": "session-test",
                    "interview_plan_id": "plan-test",
                    "candidate_id": "candidate-test",
                    "status": "waiting_candidate",
                    "livekit_room_name": "prelude-session-test",
                    "allowed_modalities": ["audio", "video"],
                    "created_at": "2026-06-17T10:00:00Z",
                    "updated_at": "2026-06-17T10:00:00Z",
                },
                "livekit_join": {
                    "room_name": "prelude-session-test",
                    "url": "wss://livekit.example.test",
                    "token": "mock_lk_session-test_agent-session-test",
                    "participant": "agent-session-test",
                    "expires_at": "2026-06-17T10:15:00Z",
                },
                "interview_plan": {
                    "id": "plan-test",
                    "role_title": "Product Manager B2B SaaS",
                    "language": "fr",
                    "allow_video": True,
                    "allow_audio_only": True,
                    "max_followups_per_question": 1,
                    "questions": [
                        {
                            "id": "q1",
                            "prompt": "Pouvez-vous vous presenter brievement ?",
                            "category": "motivation",
                        }
                    ],
                },
                "provider": "mock",
            },
        )

    client = HttpRealtimeApiClient(
        "https://realtime.example.test",
        transport=httpx.MockTransport(handler),
    )

    config = await client.get_agent_config("session-test")

    assert config.session.id == "session-test"
    assert config.livekit_join.participant == "agent-session-test"
    assert config.interview_plan.questions[0].id == "q1"
    assert config.provider == "mock"


@pytest.mark.asyncio
async def test_http_realtime_client_counts_and_checks_events() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/v1/interview-sessions/session-test"
        return httpx.Response(
            200,
            json={
                "session": {
                    "id": "session-test",
                    "events": [
                        {"type": "candidate_joined"},
                        {"type": "agent_joined"},
                    ],
                },
            },
        )

    client = HttpRealtimeApiClient(
        "https://realtime.example.test",
        transport=httpx.MockTransport(handler),
    )

    assert await client.count_events("session-test") == 2
    assert await client.has_event("session-test", EventType.CANDIDATE_JOINED)
    assert not await client.has_event("session-test", EventType.SESSION_COMPLETED)
