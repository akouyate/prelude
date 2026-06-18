from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.adapters.livekit_openai_worker import (
    LiveKitAgentEventBridge,
    OpenAILiveWorkerConfig,
    PreludeEventEmitter,
    build_live_interviewer_instructions,
    _wait_for_candidate_ready,
    _supports_realtime_reasoning,
)
from app.domain.models import EventActor, EventType, InterviewEvent, create_demo_plan


class FakeAgentSession:
    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def on(self, event_name: str):
        def register(handler: object) -> object:
            self.handlers[event_name] = handler
            return handler

        return register


@dataclass
class AssistantItem:
    role: str
    text: str

    @property
    def text_content(self) -> str:
        return self.text


@pytest.mark.asyncio
async def test_livekit_agent_bridge_persists_final_candidate_transcript() -> None:
    events: list[InterviewEvent] = []

    async def emit_event(event: InterviewEvent) -> None:
        events.append(event)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeAgentSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
    )
    bridge.register(session)

    session.handlers["user_input_transcribed"](
        SimpleNamespace(
            transcript="Je suis disponible dans deux semaines.",
            is_final=True,
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    await bridge.drain()

    assert len(events) == 1
    assert events[0].type == EventType.CANDIDATE_TURN_FINALIZED
    assert events[0].actor == EventActor.CANDIDATE
    assert events[0].payload["transcript_turn"]["speaker"] == "candidate"
    assert events[0].payload["transcript_turn"]["text"] == "Je suis disponible dans deux semaines."


@pytest.mark.asyncio
async def test_livekit_agent_bridge_persists_assistant_transcript() -> None:
    events: list[InterviewEvent] = []

    async def emit_event(event: InterviewEvent) -> None:
        events.append(event)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeAgentSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
    )
    bridge.register(session)

    session.handlers["conversation_item_added"](
        SimpleNamespace(
            item=AssistantItem(
                role="assistant",
                text="Bonjour, pouvez-vous vous presenter brievement ?",
            ),
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    await bridge.drain()

    assert len(events) == 1
    assert events[0].type == EventType.AGENT_SPEECH_COMPLETED
    assert events[0].actor == EventActor.AGENT
    assert events[0].payload["transcript_turn"]["speaker"] == "interviewer"
    assert (
        events[0].payload["transcript_turn"]["text"]
        == "Bonjour, pouvez-vous vous presenter brievement ?"
    )


def test_live_worker_config_reads_max_duration_from_env() -> None:
    config = OpenAILiveWorkerConfig.from_env(
        {
            "OPENAI_REALTIME_MODEL": "gpt-realtime",
            "OPENAI_REALTIME_VOICE": "marin",
            "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
            "OPENAI_REALTIME_REASONING_EFFORT": "low",
            "LIVE_WORKER_MAX_DURATION_SECONDS": "2.5",
        }
    )

    assert config.max_duration_seconds == 2.5
    assert config.candidate_ready_timeout_seconds == 120.0


@pytest.mark.asyncio
async def test_wait_for_candidate_ready_polls_until_candidate_joined() -> None:
    attempts = 0

    async def has_event(_session_id: str, event_type: EventType) -> bool:
        nonlocal attempts
        attempts += 1
        return event_type == EventType.CANDIDATE_JOINED and attempts == 2

    await _wait_for_candidate_ready(
        session_id="session-test",
        has_event=has_event,
        timeout_seconds=1,
        poll_interval_seconds=0,
    )

    assert attempts == 2


def test_live_interviewer_instructions_keep_first_screening_scope() -> None:
    instructions = build_live_interviewer_instructions(create_demo_plan())

    assert "first screening interview" in instructions
    assert "Ask one question at a time" in instructions
    assert "Never score or comment on face, accent, tone, emotion" in instructions
    assert "Product Manager B2B SaaS" in instructions


def test_realtime_reasoning_is_only_enabled_for_supported_models() -> None:
    assert _supports_realtime_reasoning("gpt-realtime-2")
    assert not _supports_realtime_reasoning("gpt-realtime")
