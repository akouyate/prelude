from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.adapters.openai_realtime import (
    OpenAIRealtimeConfig,
    OpenAIRealtimeSmokeProvider,
)
from app.benchmark.scenarios import BenchmarkScenarioName, load_benchmark_scenario


@pytest.mark.asyncio
async def test_openai_realtime_provider_smoke_metadata_excludes_secret() -> None:
    provider = OpenAIRealtimeSmokeProvider(
        load_benchmark_scenario(BenchmarkScenarioName.NORMAL),
        OpenAIRealtimeConfig(
            api_key="sk-test-secret",
            model="gpt-realtime",
            voice="marin",
            turn_detection="semantic_vad",
            reasoning_effort="low",
            handshake_timeout_seconds=1,
        ),
        realtime_model_factory=FakeRealtimeModel,
    )

    metadata = await provider.prepare_smoke()

    openai_metadata = metadata["openai_realtime"]
    assert openai_metadata["smoke_status"] == "connected"
    assert openai_metadata["handshake_event_type"] == "session.created"
    assert openai_metadata["openai_session_id"] == "sess_test"
    assert openai_metadata["model"] == "gpt-realtime"
    assert "sk-test-secret" not in str(metadata)


@pytest.mark.asyncio
async def test_openai_realtime_provider_sanitizes_handshake_errors() -> None:
    provider = OpenAIRealtimeSmokeProvider(
        load_benchmark_scenario(BenchmarkScenarioName.NORMAL),
        OpenAIRealtimeConfig(
            api_key="sk-test-secret",
            model="gpt-realtime",
            voice="marin",
            turn_detection="semantic_vad",
            reasoning_effort="low",
            handshake_timeout_seconds=1,
        ),
        realtime_model_factory=FailingRealtimeModel,
    )

    with pytest.raises(RuntimeError) as exc:
        await provider.prepare_smoke()

    assert "RuntimeError" in str(exc.value)
    assert "sk-test-secret" not in str(exc.value)


class FakeRealtimeModel:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs

    def session(self) -> "FakeRealtimeSession":
        return FakeRealtimeSession()

    async def aclose(self) -> None:
        return None


class FakeRealtimeSession:
    def __init__(self) -> None:
        self._handlers: dict[str, object] = {}

    def on(self, event: str, handler: object) -> None:
        self._handlers[event] = handler
        if event == "openai_server_event_received":
            asyncio.get_running_loop().call_soon(
                handler,
                {
                    "type": "session.created",
                    "event_id": "evt_session_created",
                    "session": {"id": "sess_test"},
                },
            )

    async def aclose(self) -> None:
        return None


class FailingRealtimeModel(FakeRealtimeModel):
    def session(self) -> "FailingRealtimeSession":
        return FailingRealtimeSession()


class FailingRealtimeSession(FakeRealtimeSession):
    def on(self, event: str, handler: object) -> None:
        self._handlers[event] = handler
        if event == "error":
            asyncio.get_running_loop().call_soon(
                handler,
                type(
                    "RealtimeErrorEvent",
                    (),
                    {"error": RuntimeError("provider rejected sk-test-secret")},
                )(),
            )
