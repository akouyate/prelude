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
    soft_prompt_after_seconds: float = 10.0

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> OpenAILiveWorkerConfig:
        max_duration = env.get("LIVE_WORKER_MAX_DURATION_SECONDS")
        candidate_ready_timeout = env.get("LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS")
        soft_prompt_after = env.get("LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS")
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
            soft_prompt_after_seconds=float(soft_prompt_after) if soft_prompt_after else 10.0,
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
        self._candidate_speaking = False
        self._candidate_activity_seen = False

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
                self._candidate_speaking = True
                self._candidate_activity_seen = True
                self._schedule(
                    self._emitter.emit(
                        EventType.CANDIDATE_SPEECH_STARTED,
                        {"source": "livekit_agent_session"},
                        actor=EventActor.CANDIDATE,
                        occurred_at=created_at,
                    )
                )
            elif old_state == "speaking":
                self._candidate_speaking = False
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
            self._candidate_activity_seen = True
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

    @property
    def candidate_turn_count(self) -> int:
        return self._candidate_turns

    @property
    def candidate_is_speaking(self) -> bool:
        return self._candidate_speaking

    @property
    def candidate_activity_seen(self) -> bool:
        return self._candidate_activity_seen

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
                    participant_identity=f"candidate-{self._agent_config.session.candidate_id}",
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
            await session.room_io.wait_for_ready()

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
                    "Greet the candidate briefly in the interview language, give the required "
                    "one-sentence onboarding, then ask only the first planned screening question."
                ),
                allow_interruptions=True,
            )
            await greeting.wait_for_playout()
            silence_prompt_task = asyncio.create_task(
                _soft_prompt_after_initial_silence(
                    session=session,
                    emitter=emitter,
                    bridge=bridge,
                    question_id=first_question.id,
                    threshold_seconds=self._worker_config.soft_prompt_after_seconds,
                )
            )

            try:
                if self._worker_config.max_duration_seconds:
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(
                            _wait_until_room_disconnected(room),
                            timeout=self._worker_config.max_duration_seconds,
                        )
                else:
                    await _wait_until_room_disconnected(room)
            finally:
                silence_prompt_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await silence_prompt_task

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

You are Prelude's live interview agent for a first screening interview.
Role: {plan.role_title}
Language: {plan.language}
Allowed candidate modalities: {", ".join(modalities) or "audio"}

Candidate onboarding:
- Start with one brief orientation sentence before the first question.
- Explain that this is a short first-screening conversation and that the same
  structured process helps every candidate get a consistent interview.
- Do not turn the introduction into product narration.

Role adaptation:
- Infer the interview style from the role title, planned questions, language,
  and any job context available in the conversation.
- For frontline, operational, shift-based, hospitality, logistics, restaurant,
  tourism, retail, or customer-facing roles, use plain and concrete language.
- For operational roles, prefer concrete topics such as experience, availability,
  constraints, mobility, customer interaction, work rhythm, safety, and team fit.
- For senior, office, product, technical, or management roles, you may use more
  nuanced language around impact, prioritization, collaboration, business context,
  ownership, and trade-offs.
- Never force a corporate interview style on operational candidates.

Candidate comfort:
- Be calm, respectful, warm, and non-evaluative.
- Make the candidate comfortable through clarity, patience, and useful listening,
  not through fixed canned comfort phrases.
- Do not pretend to feel emotions or overstate empathy.
- Do not over-praise the candidate. Acknowledge naturally and move forward.
- If the candidate uses audio-only, do not mention camera comfort or video presence.

Listening and pacing:
- Do not interrupt. Stop speaking when the candidate starts speaking.
- Let the candidate finish before evaluating whether a follow-up is needed.
- Use brief acknowledgements only when they help the conversation feel heard.
- Avoid paraphrasing every answer; it can feel repetitive or fake.
- Use natural pacing. Do not rush immediately after a long, sensitive, or uncertain answer.
- If an answer is complete, move to the next planned question without extra probing.
- If an answer is vague or misses a job-relevant detail, ask at most one concise follow-up.

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


async def _soft_prompt_after_initial_silence(
    *,
    session: object,
    emitter: PreludeEventEmitter,
    bridge: LiveKitAgentEventBridge,
    question_id: str,
    threshold_seconds: float,
) -> None:
    await asyncio.sleep(threshold_seconds)
    await bridge.drain()
    if (
        bridge.candidate_activity_seen
        or bridge.candidate_turn_count > 0
        or bridge.candidate_is_speaking
    ):
        return

    threshold_ms = int(threshold_seconds * 1000)
    await emitter.emit(
        EventType.SILENCE_TIMEOUT_STARTED,
        {
            "question_id": question_id,
            "tier": "soft_prompt",
            "threshold_ms": threshold_ms,
        },
        actor=EventActor.SYSTEM,
    )

    reply = getattr(session, "generate_reply")(
        instructions=(
            "The candidate has been silent after the first question. "
            "Briefly and politely ask if they can hear you, if there is a technical issue, "
            "or if they need a moment. Do not move to the next planned question."
        ),
        allow_interruptions=True,
    )
    wait_for_playout = getattr(reply, "wait_for_playout", None)
    if callable(wait_for_playout):
        await wait_for_playout()


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
