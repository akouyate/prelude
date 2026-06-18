from __future__ import annotations

import asyncio
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
    _soft_prompt_after_initial_silence,
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


class FakeReply:
    def __init__(self) -> None:
        self.playout_waited = False

    async def wait_for_playout(self) -> None:
        self.playout_waited = True


class FakeLiveSession:
    def __init__(self) -> None:
        self.replies: list[dict[str, object]] = []
        self.last_reply: FakeReply | None = None

    def generate_reply(self, **kwargs: object) -> FakeReply:
        self.replies.append(kwargs)
        self.last_reply = FakeReply()
        return self.last_reply


class FakeBridge:
    def __init__(
        self,
        *,
        candidate_turn_count: int = 0,
        candidate_is_speaking: bool = False,
        candidate_activity_seen: bool = False,
    ):
        self.candidate_turn_count = candidate_turn_count
        self.candidate_is_speaking = candidate_is_speaking
        self.candidate_activity_seen = candidate_activity_seen
        self.drained = False

    async def drain(self) -> None:
        self.drained = True


async def _append_event(events: list[InterviewEvent], event: InterviewEvent) -> None:
    events.append(event)


@pytest.mark.asyncio
async def test_emitter_serializes_event_delivery_by_sequence() -> None:
    events: list[InterviewEvent] = []
    first_event_started = asyncio.Event()
    release_first_event = asyncio.Event()

    async def emit_event(event: InterviewEvent) -> None:
        if event.sequence == 1:
            first_event_started.set()
            await release_first_event.wait()
        events.append(event)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )

    first = asyncio.create_task(
        emitter.emit(EventType.AGENT_SPEECH_STARTED, {}, actor=EventActor.AGENT)
    )
    await first_event_started.wait()
    second = asyncio.create_task(
        emitter.emit(EventType.AGENT_SPEECH_COMPLETED, {}, actor=EventActor.AGENT)
    )

    await asyncio.sleep(0)
    assert events == []

    release_first_event.set()
    await asyncio.gather(first, second)

    assert [event.sequence for event in events] == [1, 2]


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
            "LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS": "8",
        }
    )

    assert config.max_duration_seconds == 2.5
    assert config.candidate_ready_timeout_seconds == 120.0
    assert config.soft_prompt_after_seconds == 8


@pytest.mark.asyncio
async def test_soft_prompt_after_initial_silence_emits_event_and_reprompts() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()
    bridge = FakeBridge()

    await _soft_prompt_after_initial_silence(
        session=session,
        emitter=emitter,
        bridge=bridge,
        question_id="q1",
        threshold_seconds=0,
    )

    assert bridge.drained
    assert events[0].type == EventType.SILENCE_TIMEOUT_STARTED
    assert events[0].actor == EventActor.SYSTEM
    assert events[0].payload == {
        "question_id": "q1",
        "tier": "soft_prompt",
        "threshold_ms": 0,
    }
    assert session.replies
    assert session.replies[0]["allow_interruptions"] is True
    assert session.last_reply is not None
    assert session.last_reply.playout_waited


@pytest.mark.asyncio
async def test_soft_prompt_after_initial_silence_skips_when_candidate_answered() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()

    await _soft_prompt_after_initial_silence(
        session=session,
        emitter=emitter,
        bridge=FakeBridge(candidate_turn_count=1),
        question_id="q1",
        threshold_seconds=0,
    )

    assert events == []
    assert session.replies == []


@pytest.mark.asyncio
async def test_soft_prompt_after_initial_silence_skips_when_candidate_had_activity() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()

    await _soft_prompt_after_initial_silence(
        session=session,
        emitter=emitter,
        bridge=FakeBridge(candidate_activity_seen=True),
        question_id="q1",
        threshold_seconds=0,
    )

    assert events == []
    assert session.replies == []


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
