from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping

from app.domain.models import (
    AgentConfig,
    EventActor,
    EventType,
    InterviewEvent,
    InterviewPlan,
)
from app.domain.state_machine import INTERVIEWER_STATE_MACHINE_INSTRUCTIONS


@dataclass(frozen=True)
class OpenAILiveWorkerConfig:
    model: str
    voice: str
    turn_detection: str
    reasoning_effort: str
    input_transcription_model: str = "gpt-4o-transcribe"
    max_duration_seconds: float | None = None
    candidate_ready_timeout_seconds: float = 120.0

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> OpenAILiveWorkerConfig:
        max_duration = env.get("LIVE_WORKER_MAX_DURATION_SECONDS")
        candidate_ready_timeout = env.get("LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS")
        return cls(
            model=env["OPENAI_REALTIME_MODEL"],
            voice=env["OPENAI_REALTIME_VOICE"],
            turn_detection=env["OPENAI_REALTIME_TURN_DETECTION"],
            reasoning_effort=env["OPENAI_REALTIME_REASONING_EFFORT"],
            input_transcription_model=env.get(
                "OPENAI_REALTIME_TRANSCRIPTION_MODEL",
                "gpt-4o-transcribe",
            ),
            max_duration_seconds=float(max_duration) if max_duration else None,
            candidate_ready_timeout_seconds=float(candidate_ready_timeout)
            if candidate_ready_timeout
            else 120.0,
        )


class PreludeEventEmitter:
    def __init__(
        self,
        *,
        session_id: str,
        candidate_id: str | None,
        provider_metadata: dict[str, object],
        emit_event: Callable[[InterviewEvent], Awaitable[None]],
        initial_sequence: int = 0,
    ) -> None:
        self._session_id = session_id
        self._candidate_id = candidate_id
        self._provider_metadata = provider_metadata
        self._emit_event = emit_event
        self._sequence = initial_sequence
        self._lock = asyncio.Lock()

    async def emit(
        self,
        event_type: EventType,
        payload: dict[str, object],
        *,
        actor: EventActor = EventActor.SYSTEM,
        occurred_at: datetime | None = None,
    ) -> None:
        async with self._lock:
            self._sequence += 1
            sequence = self._sequence

        await self._emit_event(
            InterviewEvent(
                type=event_type,
                actor=actor,
                session_id=self._session_id,
                candidate_id=self._candidate_id,
                sequence=sequence,
                idempotency_key=f"{self._session_id}:live-openai:{sequence}",
                occurred_at=occurred_at or datetime.now(timezone.utc),
                payload=payload,
                provider_metadata=self._provider_metadata,
            )
        )


class LiveKitAgentEventBridge:
    def __init__(
        self,
        *,
        emitter: PreludeEventEmitter,
    ) -> None:
        self._emitter = emitter
        self._tasks: set[asyncio.Task[None]] = set()
        self._assistant_turns = 0
        self._candidate_turns = 0

    def register(self, session: object) -> None:
        on = getattr(session, "on")

        @on("agent_state_changed")
        def on_agent_state_changed(event: object) -> None:
            old_state = getattr(event, "old_state", None)
            new_state = getattr(event, "new_state", None)
            created_at = _created_at(event)
            if new_state == "speaking":
                self._schedule(
                    self._emitter.emit(
                        EventType.AGENT_SPEECH_STARTED,
                        {"source": "livekit_agent_session"},
                        actor=EventActor.AGENT,
                        occurred_at=created_at,
                    )
                )
            elif old_state == "speaking":
                self._schedule(
                    self._emitter.emit(
                        EventType.AGENT_SPEECH_COMPLETED,
                        {"source": "livekit_agent_session"},
                        actor=EventActor.AGENT,
                        occurred_at=created_at,
                    )
                )

        @on("user_state_changed")
        def on_user_state_changed(event: object) -> None:
            old_state = getattr(event, "old_state", None)
            new_state = getattr(event, "new_state", None)
            created_at = _created_at(event)
            if new_state == "speaking":
                self._schedule(
                    self._emitter.emit(
                        EventType.CANDIDATE_SPEECH_STARTED,
                        {"source": "livekit_agent_session"},
                        actor=EventActor.CANDIDATE,
                        occurred_at=created_at,
                    )
                )
            elif old_state == "speaking":
                self._schedule(
                    self._emitter.emit(
                        EventType.CANDIDATE_SPEECH_STOPPED,
                        {"source": "livekit_agent_session"},
                        actor=EventActor.CANDIDATE,
                        occurred_at=created_at,
                    )
                )

        @on("user_input_transcribed")
        def on_user_input_transcribed(event: object) -> None:
            if not getattr(event, "is_final", False):
                return

            transcript = str(getattr(event, "transcript", "")).strip()
            if not transcript:
                return

            self._candidate_turns += 1
            created_at = _created_at(event)
            turn_id = f"{self._emitter._session_id}:candidate:{self._candidate_turns}"
            self._schedule(
                self._emitter.emit(
                    EventType.CANDIDATE_TURN_FINALIZED,
                    {
                        "completion_reason": "live_transcription_final",
                        "transcript_turn": {
                            "turn_id": turn_id,
                            "session_id": self._emitter._session_id,
                            "speaker": "candidate",
                            "text": transcript,
                            "is_final": True,
                            "started_at": created_at.isoformat(),
                            "ended_at": created_at.isoformat(),
                        },
                    },
                    actor=EventActor.CANDIDATE,
                    occurred_at=created_at,
                )
            )

        @on("conversation_item_added")
        def on_conversation_item_added(event: object) -> None:
            item = getattr(event, "item", None)
            if getattr(item, "role", None) != "assistant":
                return

            text = getattr(item, "text_content", None)
            if callable(text):
                text = text()
            text = str(text or "").strip()
            if not text:
                return

            self._assistant_turns += 1
            created_at = _created_at(event)
            turn_id = f"{self._emitter._session_id}:interviewer:{self._assistant_turns}"
            self._schedule(
                self._emitter.emit(
                    EventType.AGENT_SPEECH_COMPLETED,
                    {
                        "source": "livekit_agent_session",
                        "transcript_turn": {
                            "turn_id": turn_id,
                            "session_id": self._emitter._session_id,
                            "speaker": "interviewer",
                            "text": text,
                            "is_final": True,
                            "started_at": created_at.isoformat(),
                            "ended_at": created_at.isoformat(),
                        },
                    },
                    actor=EventActor.AGENT,
                    occurred_at=created_at,
                )
            )

        @on("error")
        def on_error(event: object) -> None:
            self._schedule(
                self._emitter.emit(
                    EventType.SESSION_FAILED,
                    {"error": repr(getattr(event, "error", event))},
                    actor=EventActor.SYSTEM,
                    occurred_at=_created_at(event),
                )
            )

    async def drain(self) -> None:
        while self._tasks:
            pending = list(self._tasks)
            await asyncio.gather(*pending)
            for task in pending:
                self._tasks.discard(task)

    def _schedule(self, awaitable: Awaitable[None]) -> None:
        task = asyncio.create_task(awaitable)
        self._tasks.add(task)


class OpenAILiveKitWorker:
    def __init__(
        self,
        *,
        agent_config: AgentConfig,
        realtime_api_emit_event: Callable[[InterviewEvent], Awaitable[None]],
        realtime_api_has_event: Callable[[str, EventType], Awaitable[bool]],
        realtime_api_count_events: Callable[[str], Awaitable[int]],
        worker_config: OpenAILiveWorkerConfig,
    ) -> None:
        self._agent_config = agent_config
        self._emit_event = realtime_api_emit_event
        self._has_event = realtime_api_has_event
        self._count_events = realtime_api_count_events
        self._worker_config = worker_config
        self._room = None
        self._agent_session = None
        self._realtime_model = None

    async def run(self) -> int:
        try:
            from livekit import agents, rtc
            from livekit.agents import room_io
            from livekit.plugins import openai
            from openai.types import realtime
        except ImportError as exc:
            raise RuntimeError(
                "livekit-agents[openai] is required for the OpenAI live worker. "
                "Install dependencies from services/interviewer-agent/requirements.txt."
            ) from exc

        try:
            provider_metadata = {
                "provider": "openai_realtime",
                "openai_realtime": {
                    "mode": "livekit_agent_session",
                    "model": self._worker_config.model,
                    "voice": self._worker_config.voice,
                    "turn_detection": self._worker_config.turn_detection,
                    "reasoning_effort": self._worker_config.reasoning_effort,
                },
                "livekit": {
                    "room_name": self._agent_config.livekit_join.room_name,
                    "agent_participant": self._agent_config.livekit_join.participant,
                },
            }
            await _wait_for_candidate_ready(
                session_id=self._agent_config.session.id,
                has_event=self._has_event,
                timeout_seconds=self._worker_config.candidate_ready_timeout_seconds,
            )
            initial_sequence = await self._count_events(self._agent_config.session.id)
            emitter = PreludeEventEmitter(
                session_id=self._agent_config.session.id,
                candidate_id=self._agent_config.session.candidate_id,
                provider_metadata=provider_metadata,
                emit_event=self._emit_event,
                initial_sequence=initial_sequence,
            )

            room = rtc.Room()
            await room.connect(
                self._agent_config.livekit_join.url,
                self._agent_config.livekit_join.token,
            )
            self._room = room

            await emitter.emit(
                EventType.AGENT_JOINED,
                {
                    "agent_participant_id": self._agent_config.livekit_join.participant,
                    "provider": "openai_realtime",
                    "room_name": self._agent_config.livekit_join.room_name,
                },
                actor=EventActor.AGENT,
            )

            llm_kwargs = {
                "model": self._worker_config.model,
                "voice": self._worker_config.voice,
                "modalities": ["audio"],
                "input_audio_transcription": realtime.AudioTranscription(
                    model=self._worker_config.input_transcription_model,
                    language=self._agent_config.interview_plan.language,
                ),
                "turn_detection": _turn_detection(
                    realtime,
                    self._worker_config.turn_detection,
                ),
            }
            if _supports_realtime_reasoning(self._worker_config.model):
                llm_kwargs["reasoning"] = realtime.RealtimeReasoning(
                    effort=self._worker_config.reasoning_effort,
                )
            llm = openai.realtime.RealtimeModel(**llm_kwargs)
            self._realtime_model = llm
            session = agents.AgentSession(
                llm=llm,
                turn_handling=agents.TurnHandlingOptions(
                    turn_detection="realtime_llm",
                ),
            )
            self._agent_session = session
            bridge = LiveKitAgentEventBridge(
                emitter=emitter,
            )
            bridge.register(session)

            instructions = build_live_interviewer_instructions(
                self._agent_config.interview_plan
            )
            await session.start(
                room=room,
                agent=agents.Agent(instructions=instructions),
                room_options=room_io.RoomOptions(
                    audio_input=room_io.AudioInputOptions(
                        sample_rate=24000,
                        num_channels=1,
                        frame_size_ms=50,
                    ),
                    audio_output=room_io.AudioOutputOptions(
                        sample_rate=24000,
                        num_channels=1,
                        track_name="prelude-interviewer-audio",
                    ),
                    text_output=True,
                    close_on_disconnect=True,
                ),
            )

            await emitter.emit(
                EventType.SESSION_STARTED,
                {
                    "plan_id": self._agent_config.interview_plan.id,
                    "provider": "openai_realtime",
                    "agent_participant_id": self._agent_config.livekit_join.participant,
                },
                actor=EventActor.AGENT,
            )

            first_question = self._agent_config.interview_plan.questions[0]
            question_started_at = datetime.now(timezone.utc)
            await emitter.emit(
                EventType.AGENT_SPEECH_STARTED,
                {
                    "question_id": first_question.id,
                    "utterance_id": f"{first_question.id}:live-openai:question:1",
                    "utterance_kind": "question",
                },
                actor=EventActor.AGENT,
                occurred_at=question_started_at,
            )
            await emitter.emit(
                EventType.QUESTION_ASKED,
                {
                    "question_id": first_question.id,
                    "question_index": 0,
                    "prompt": first_question.prompt,
                    "category": first_question.category.value,
                    "transcript_turn": {
                        "turn_id": f"{self._agent_config.session.id}:interviewer:planned:1",
                        "session_id": self._agent_config.session.id,
                        "question_id": first_question.id,
                        "speaker": "interviewer",
                        "text": first_question.prompt,
                        "is_final": True,
                        "started_at": question_started_at.isoformat(),
                        "ended_at": datetime.now(timezone.utc).isoformat(),
                    },
                },
                actor=EventActor.AGENT,
            )

            greeting = session.generate_reply(
                instructions=(
                    "Greet the candidate briefly in the interview language, then ask only "
                    "the first planned screening question."
                ),
                allow_interruptions=True,
            )

            if self._worker_config.max_duration_seconds:
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        greeting.wait_for_playout(),
                        timeout=self._worker_config.max_duration_seconds,
                    )
            else:
                await _wait_until_room_disconnected(room)

            await bridge.drain()
            return emitter._sequence
        finally:
            await self.aclose()

    async def aclose(self) -> None:
        if self._agent_session is not None:
            await self._agent_session.aclose()
            self._agent_session = None
        if self._realtime_model is not None:
            await self._realtime_model.aclose()
            self._realtime_model = None
        if self._room is not None:
            await self._room.disconnect()
            self._room = None


def build_live_interviewer_instructions(plan: InterviewPlan) -> str:
    questions = "\n".join(
        f"{index}. [{question.category.value}] {question.prompt}"
        + (f" Follow-up allowed: {question.follow_up_prompt}" if question.follow_up_prompt else "")
        for index, question in enumerate(plan.questions, start=1)
    )
    modalities = []
    if plan.allow_audio_only:
        modalities.append("audio-only")
    if plan.allow_video:
        modalities.append("video")

    return f"""{INTERVIEWER_STATE_MACHINE_INSTRUCTIONS}

You are Prelude's live IA interviewer for a first screening interview.
Role: {plan.role_title}
Language: {plan.language}
Allowed candidate modalities: {", ".join(modalities) or "audio"}

Business rules:
- Be polite, concise, and professional.
- Ask one question at a time and wait for the candidate to finish.
- Never score or comment on face, accent, tone, emotion, appearance, or camera comfort.
- Do not conduct a full hiring interview. This is only a first filter.
- Use the planned questions in order. Ask at most {plan.max_followups_per_question} short follow-up per question when the answer is vague.
- If the candidate asks for a repeat, repeat the current question once.
- If the candidate asks for time, acknowledge it briefly and wait.
- Close warmly after the planned questions.

Planned questions:
{questions}
"""


def _turn_detection(realtime: object, value: str) -> object:
    module = realtime.realtime_audio_input_turn_detection
    if value == "server_vad":
        return module.ServerVad(
            type="server_vad",
            create_response=True,
            interrupt_response=True,
            silence_duration_ms=700,
            prefix_padding_ms=300,
        )

    return module.SemanticVad(
        type="semantic_vad",
        create_response=True,
        eagerness="auto",
        interrupt_response=True,
    )


def _supports_realtime_reasoning(model: str) -> bool:
    return "realtime-2" in model


async def _wait_for_candidate_ready(
    *,
    session_id: str,
    has_event: Callable[[str, EventType], Awaitable[bool]],
    timeout_seconds: float,
    poll_interval_seconds: float = 0.5,
) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while True:
        if await has_event(session_id, EventType.CANDIDATE_JOINED):
            return
        if asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError(
                f"candidate readiness event was not received for session {session_id}"
            )
        await asyncio.sleep(poll_interval_seconds)


async def _wait_until_room_disconnected(room: object) -> None:
    while getattr(room, "isconnected")():
        await asyncio.sleep(0.5)


def _created_at(event: object) -> datetime:
    raw = getattr(event, "created_at", None)
    if isinstance(raw, int | float):
        return datetime.fromtimestamp(raw, tz=timezone.utc)
    return datetime.now(timezone.utc)
