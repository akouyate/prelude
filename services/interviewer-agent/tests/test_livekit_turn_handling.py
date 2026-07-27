from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

import pytest
from app.adapters.livekit_openai_worker import (
    CandidateAbsenceMonitor,
    LiveKitAgentEventBridge,
    OpenAILiveWorkerConfig,
    PreludeEventEmitter,
    _build_livekit_turn_handling,
    _create_prelude_controlled_agent,
)
from app.domain.models import EventActor, EventType, InterviewEvent


class FakeTurnDetector:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs


class FakeInference:
    TurnDetector = FakeTurnDetector


class FakeAgents:
    inference = FakeInference()
    TurnHandlingOptions = dict


class FakeRealtime:
    class realtime_audio_input_turn_detection:
        class SemanticVad:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class ServerVad:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs


class FakeSession:
    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def on(self, event_name: str):
        def register(handler: object) -> object:
            self.handlers[event_name] = handler
            return handler

        return register


class UserItem:
    role = "user"

    def __init__(self, *, item_id: str, text: str) -> None:
        self.id = item_id
        self.text_content = text


class FakeRoom:
    def __init__(self, *, participants: list[object] | None = None) -> None:
        self.handlers: dict[str, object] = {}
        if participants is not None:
            self.remote_participants = {
                participant.identity: participant for participant in participants
            }

    def on(self, event_name: str):
        def register(handler: object) -> object:
            self.handlers[event_name] = handler
            return handler

        return register


def _config(*, legacy: bool = False) -> OpenAILiveWorkerConfig:
    return OpenAILiveWorkerConfig(
        model="gpt-realtime",
        voice="marin",
        turn_detection="semantic_vad",
        reasoning_effort="low",
        legacy_turn_handling=legacy,
    )


def test_livekit_turn_handling_uses_v1_mini_and_adaptive_interruption_by_default() -> (
    None
):
    runtime = _build_livekit_turn_handling(
        FakeAgents,
        FakeRealtime,
        _config(),
    )

    assert runtime.realtime_turn_detection is None
    assert runtime.legacy_overlap_guard is False
    detector = runtime.session_turn_handling["turn_detection"]
    assert isinstance(detector, FakeTurnDetector)
    assert detector.kwargs == {"version": "v1-mini"}
    assert runtime.session_turn_handling["endpointing"] == {
        "mode": "dynamic",
        "min_delay": 1.0,
        "max_delay": 3.0,
    }
    assert runtime.session_turn_handling["interruption"] == {
        "enabled": True,
        "mode": "adaptive",
        "min_duration": 0.5,
        "resume_false_interruption": True,
        "false_interruption_timeout": 2.0,
        "backchannel_boundary": (1.0, 1.0),
    }


@pytest.mark.asyncio
async def test_prelude_controlled_agent_stops_livekit_automatic_response() -> None:
    from livekit import agents

    committed_messages: list[object] = []
    agent = _create_prelude_controlled_agent(
        agents,
        instructions="Prelude owns every spoken response.",
        on_user_turn_completed=committed_messages.append,
    )
    message = UserItem(item_id="complete-turn", text="The complete answer.")

    assert isinstance(agent, agents.Agent)
    with pytest.raises(agents.StopResponse):
        await agent.on_user_turn_completed(None, message)
    assert committed_messages == [message]


def test_livekit_turn_handling_retains_explicit_deprecated_legacy_fallback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        runtime = _build_livekit_turn_handling(
            FakeAgents,
            FakeRealtime,
            _config(legacy=True),
        )

    assert isinstance(
        runtime.realtime_turn_detection,
        FakeRealtime.realtime_audio_input_turn_detection.SemanticVad,
    )
    assert runtime.session_turn_handling == {"turn_detection": "realtime_llm"}
    assert runtime.legacy_overlap_guard is True
    assert "deprecated LiveKit turn handling enabled" in caplog.text


def test_live_worker_config_defaults_to_official_turn_handling() -> None:
    base_env = {
        "OPENAI_REALTIME_MODEL": "gpt-realtime",
        "OPENAI_REALTIME_VOICE": "marin",
        "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
        "OPENAI_REALTIME_REASONING_EFFORT": "low",
    }

    assert OpenAILiveWorkerConfig.from_env(base_env).legacy_turn_handling is False
    assert OpenAILiveWorkerConfig.from_env(base_env).turn_detector_version == "v1-mini"
    assert (
        OpenAILiveWorkerConfig.from_env(base_env).livekit_stt_model
        == "deepgram/nova-3"
    )
    assert (
        OpenAILiveWorkerConfig.from_env(base_env).exact_tts_model
        == "gpt-4o-mini-tts"
    )
    assert OpenAILiveWorkerConfig.from_env(base_env).exact_tts_voice is None
    assert (
        OpenAILiveWorkerConfig.from_env(base_env).candidate_absence_grace_seconds
        == 300.0
    )
    assert (
        OpenAILiveWorkerConfig.from_env(
            {
                **base_env,
                "LIVEKIT_LEGACY_TURN_HANDLING": "true",
                "LIVE_WORKER_CANDIDATE_ABSENCE_GRACE_SECONDS": "45",
            }
        ).legacy_turn_handling
        is True
    )
    assert (
        OpenAILiveWorkerConfig.from_env(
            {
                **base_env,
                "LIVE_WORKER_CANDIDATE_ABSENCE_GRACE_SECONDS": "45",
                "LIVEKIT_TURN_DETECTOR_VERSION": "v1",
            }
        ).candidate_absence_grace_seconds
        == 45.0
    )
    assert (
        OpenAILiveWorkerConfig.from_env(
            {**base_env, "LIVEKIT_TURN_DETECTOR_VERSION": "v1"}
        ).turn_detector_version
        == "v1"
    )
    assert (
        OpenAILiveWorkerConfig.from_env(
            {**base_env, "LIVEKIT_STT_MODEL": "cartesia/ink-2"}
        ).livekit_stt_model
        == "cartesia/ink-2"
    )
    overridden_tts = OpenAILiveWorkerConfig.from_env(
        {
            **base_env,
            "OPENAI_EXACT_TTS_MODEL": "tts-1",
            "OPENAI_EXACT_TTS_VOICE": "alloy",
        }
    )
    assert overridden_tts.exact_tts_model == "tts-1"
    assert overridden_tts.exact_tts_voice == "alloy"


def test_live_worker_config_rejects_unknown_turn_detector_version() -> None:
    with pytest.raises(ValueError, match="LIVEKIT_TURN_DETECTOR_VERSION"):
        OpenAILiveWorkerConfig.from_env(
            {
                "OPENAI_REALTIME_MODEL": "gpt-realtime",
                "OPENAI_REALTIME_VOICE": "marin",
                "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
                "OPENAI_REALTIME_REASONING_EFFORT": "low",
                "LIVEKIT_TURN_DETECTOR_VERSION": "v2",
            }
        )


@pytest.mark.asyncio
async def test_candidate_absence_monitor_cancels_timeout_on_reconnect() -> None:
    timed_out: list[str] = []
    connection_events: list[str] = []

    async def on_timeout() -> None:
        timed_out.append("candidate-1")

    room = FakeRoom()
    monitor = CandidateAbsenceMonitor(
        candidate_identity="candidate-1",
        grace_seconds=0.02,
        on_timeout=on_timeout,
        on_disconnected=lambda: connection_events.append("disconnected"),
        on_reconnected=lambda: connection_events.append("reconnected"),
    )
    monitor.register(room)
    candidate = SimpleNamespace(identity="candidate-1")

    room.handlers["participant_disconnected"](candidate)
    await asyncio.sleep(0.01)
    room.handlers["participant_connected"](candidate)
    await asyncio.sleep(0.02)

    assert timed_out == []
    assert connection_events == ["disconnected", "reconnected"]
    await monitor.aclose()


@pytest.mark.asyncio
async def test_candidate_absence_monitor_times_out_only_target_candidate() -> None:
    timed_out: list[str] = []

    async def on_timeout() -> None:
        timed_out.append("candidate-1")

    room = FakeRoom()
    monitor = CandidateAbsenceMonitor(
        candidate_identity="candidate-1",
        grace_seconds=0.01,
        on_timeout=on_timeout,
    )
    monitor.register(room)

    room.handlers["participant_disconnected"](
        SimpleNamespace(identity="other-participant")
    )
    await asyncio.sleep(0.02)
    assert timed_out == []

    room.handlers["participant_disconnected"](SimpleNamespace(identity="candidate-1"))
    await asyncio.sleep(0.02)
    assert timed_out == ["candidate-1"]
    await monitor.aclose()


@pytest.mark.asyncio
async def test_candidate_absence_monitor_arms_when_candidate_left_before_registration() -> (
    None
):
    timed_out: list[str] = []
    connection_events: list[str] = []

    async def on_timeout() -> None:
        timed_out.append("candidate-1")

    room = FakeRoom(participants=[])
    monitor = CandidateAbsenceMonitor(
        candidate_identity="candidate-1",
        grace_seconds=0.01,
        on_timeout=on_timeout,
        on_disconnected=lambda: connection_events.append("disconnected"),
    )

    monitor.register(room)
    await asyncio.sleep(0.02)

    assert timed_out == ["candidate-1"]
    assert connection_events == ["disconnected"]
    await monitor.aclose()


@pytest.mark.asyncio
async def test_candidate_absence_monitor_keeps_present_candidate_active() -> None:
    timed_out: list[str] = []
    candidate = SimpleNamespace(identity="candidate-1")

    async def on_timeout() -> None:
        timed_out.append("candidate-1")

    room = FakeRoom(participants=[candidate])
    monitor = CandidateAbsenceMonitor(
        candidate_identity="candidate-1",
        grace_seconds=0.01,
        on_timeout=on_timeout,
    )

    monitor.register(room)
    await asyncio.sleep(0.02)

    assert timed_out == []
    await monitor.aclose()


@pytest.mark.asyncio
async def test_disconnected_bridge_suspends_turn_orchestration() -> None:
    finalized: list[str] = []

    async def emit_event(_event: InterviewEvent) -> None:
        return None

    async def finalize(
        transcript: str,
        _created_at: object,
        **_kwargs: object,
    ) -> None:
        finalized.append(transcript)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        handle_turn_handler=finalize,
        question_id_provider=lambda: "q1",
        prompt_generation_provider=lambda: 1,
        emit_state_events=False,
    )
    bridge.register(session)
    bridge.pause_for_candidate_disconnect()

    session.handlers["conversation_item_added"](
        SimpleNamespace(
            item=UserItem(item_id="offline-turn", text="Stale offline transcript."),
            created_at=0.0,
        )
    )
    await bridge.drain()

    assert finalized == []


@pytest.mark.asyncio
async def test_official_mode_finalizes_once_on_livekit_committed_user_turn() -> None:
    recorded: list[str] = []
    finalized: list[str] = []

    async def emit_event(_event: InterviewEvent) -> None:
        return None

    async def record(
        transcript: str,
        _created_at: object,
        **_kwargs: object,
    ) -> str:
        recorded.append(transcript)
        return f"turn-{len(recorded)}"

    async def finalize(
        transcript: str,
        _created_at: object,
        **_kwargs: object,
    ) -> None:
        finalized.append(transcript)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        record_transcript_handler=record,
        handle_turn_handler=finalize,
        question_id_provider=lambda: "q1",
        prompt_generation_provider=lambda: 1,
        turn_flush_debounce_seconds=10,
        legacy_overlap_guard=False,
        emit_state_events=False,
    )
    bridge.register(session)
    item = UserItem(item_id="user-turn-1", text="A complete committed answer.")

    session.handlers["user_input_transcribed"](
        SimpleNamespace(
            transcript="A complete committed answer.",
            is_final=True,
            created_at=0.0,
        )
    )
    session.handlers["conversation_item_added"](
        SimpleNamespace(item=item, created_at=0.0)
    )
    bridge.commit_official_user_message(item)
    await asyncio.wait_for(bridge.drain(), timeout=0.1)

    session.handlers["conversation_item_added"](
        SimpleNamespace(item=item, created_at=0.0)
    )
    bridge.commit_official_user_message(item)
    await bridge.drain()

    assert recorded == ["A complete committed answer."]
    assert finalized == ["A complete committed answer."]
    assert bridge.candidate_turn_count == 1


@pytest.mark.asyncio
async def test_official_mode_ignores_partial_transcript_events_until_turn_hook() -> None:
    recorded: list[str] = []
    finalized: list[str] = []

    async def emit_event(_event: InterviewEvent) -> None:
        return None

    async def record(
        transcript: str,
        _created_at: object,
        **_kwargs: object,
    ) -> str:
        recorded.append(transcript)
        return f"turn-{len(recorded)}"

    async def finalize(
        transcript: str,
        _created_at: object,
        **_kwargs: object,
    ) -> None:
        finalized.append(transcript)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        record_transcript_handler=record,
        handle_turn_handler=finalize,
        question_id_provider=lambda: "q1",
        prompt_generation_provider=lambda: 1,
        legacy_overlap_guard=False,
        emit_state_events=False,
    )
    bridge.register(session)

    session.handlers["user_input_transcribed"](
        SimpleNamespace(transcript="Recently,", is_final=True, created_at=0.0)
    )
    session.handlers["conversation_item_added"](
        SimpleNamespace(
            item=UserItem(item_id="partial-turn", text="Recently,"),
            created_at=0.0,
        )
    )
    await bridge.drain()

    assert recorded == []
    assert finalized == []

    bridge.commit_official_user_message(
        UserItem(
            item_id="complete-turn",
            text="Recently, I led a migration that reduced processing time by 30%.",
        )
    )
    await bridge.drain()

    assert recorded == [
        "Recently, I led a migration that reduced processing time by 30%."
    ]
    assert finalized == [
        "Recently, I led a migration that reduced processing time by 30%."
    ]


@pytest.mark.asyncio
async def test_official_turn_is_deduplicated_only_after_success() -> None:
    attempts = 0

    async def emit_event(_event: InterviewEvent) -> None:
        return None

    async def finalize(
        _transcript: str,
        _created_at: object,
        **_kwargs: object,
    ) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("transient policy failure")

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        handle_turn_handler=finalize,
        question_id_provider=lambda: "q1",
        prompt_generation_provider=lambda: 1,
        legacy_overlap_guard=False,
        emit_state_events=False,
    )
    bridge.register(session)
    event = SimpleNamespace(
        item=UserItem(item_id="retryable-turn", text="A committed answer."),
        created_at=0.0,
    )

    bridge.commit_official_user_message(event.item)
    with pytest.raises(RuntimeError, match="transient policy failure"):
        await bridge.drain()

    bridge.commit_official_user_message(event.item)
    await bridge.drain()

    assert attempts == 2


@pytest.mark.asyncio
async def test_bridge_logs_background_task_failure_immediately(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def emit_event(_event: InterviewEvent) -> None:
        raise RuntimeError("event store unavailable")

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    bridge = LiveKitAgentEventBridge(emitter=emitter)
    bridge.register(session)

    with caplog.at_level(logging.ERROR):
        session.handlers["user_state_changed"](
            SimpleNamespace(old_state="listening", new_state="speaking", created_at=0.0)
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    assert "livekit bridge task failed" in caplog.text
    with pytest.raises(RuntimeError, match="event store unavailable"):
        await bridge.drain()


@pytest.mark.asyncio
async def test_bridge_forwards_away_and_active_user_states() -> None:
    async def emit_event(_event: InterviewEvent) -> None:
        return None

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    state_changes: list[str] = []
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        candidate_away_handler=lambda: state_changes.append("away"),
        candidate_active_handler=lambda source: state_changes.append(source),
        emit_state_events=False,
    )
    bridge.register(session)

    session.handlers["user_state_changed"](
        SimpleNamespace(old_state="listening", new_state="away", created_at=0.0)
    )
    session.handlers["user_state_changed"](
        SimpleNamespace(old_state="away", new_state="speaking", created_at=1.0)
    )
    session.handlers["user_state_changed"](
        SimpleNamespace(old_state="speaking", new_state="listening", created_at=2.0)
    )
    await bridge.drain()

    assert state_changes == ["away", "voice", "voice"]


def test_bridge_logs_livekit_turn_metrics_and_session_usage(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def emit_event(_event: InterviewEvent) -> None:
        return None

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        question_id_provider=lambda: "q2",
    )
    bridge.register(session)

    with caplog.at_level(logging.INFO):
        session.handlers["conversation_item_added"](
            SimpleNamespace(
                item=SimpleNamespace(
                    role="user",
                    text_content="A complete answer.",
                    metrics=SimpleNamespace(
                        type="metrics_report",
                        e2e_latency=0.64,
                        end_of_utterance_delay=0.42,
                        transcription_delay=0.12,
                        on_user_turn_completed_delay=0.07,
                    ),
                ),
                created_at=0.0,
            )
        )
        session.handlers["session_usage_updated"](
            SimpleNamespace(
                usage=SimpleNamespace(
                    model_usage=[
                        SimpleNamespace(
                            type="llm",
                            provider="openai",
                            model="gpt-realtime",
                        )
                    ]
                )
            )
        )

    turn_record = next(
        item for item in caplog.records if item.getMessage() == "livekit turn metric"
    )
    assert turn_record.session_id == "session-test"
    assert turn_record.question_id == "q2"
    assert turn_record.role == "user"
    assert turn_record.metric_type == "metrics_report"
    assert turn_record.e2e_latency == 0.64
    assert turn_record.end_of_utterance_delay == 0.42

    usage_record = next(
        item
        for item in caplog.records
        if item.getMessage() == "livekit session usage"
    )
    assert usage_record.session_id == "session-test"
    assert usage_record.provider == "openai"
    assert usage_record.model == "gpt-realtime"
    assert usage_record.usage_type == "llm"
