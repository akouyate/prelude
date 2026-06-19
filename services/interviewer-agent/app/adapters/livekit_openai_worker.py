from __future__ import annotations

import asyncio
import contextlib
import re
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping

from app.domain.models import (
    AgentConfig,
    CandidateTurn,
    CandidateTurnIntent,
    EventActor,
    EventType,
    InterviewEvent,
    InterviewPlan,
    InterviewStyle,
)
from app.domain.orchestrator import (
    AnswerClassification,
    InterviewOrchestrator,
    OrchestratorCommand,
    OrchestratorCommandType,
)
from app.domain.state_machine import INTERVIEWER_STATE_MACHINE_INSTRUCTIONS


FIRST_REPLY_INSTRUCTIONS = (
    "Greet the candidate briefly in the interview language, give the required "
    "one-sentence onboarding, then ask only the first planned screening question. "
    "Do not add another greeting before the first planned question. If interrupted, "
    "do not restart the greeting or onboarding; resume the current planned question."
)

INITIAL_GREETING_RE = re.compile(
    r"^\s*(bonjour|bonsoir|hello|hi|good morning|good afternoon|good evening)"
    r"[\s,;:!-]+",
    flags=re.IGNORECASE,
)


@dataclass(frozen=True)
class CandidateTurnDecision:
    intent: CandidateTurnIntent
    is_answer_to_active_question: bool
    is_complete: bool
    repeat_requested: bool = False
    wait_requested: bool = False
    skip_requested: bool = False
    reason: str | None = None


@dataclass(frozen=True)
class CandidateSupportResponse:
    prompt: str
    instructions: str
    reason: str


class CandidateTurnClassifier:
    """Classifies candidate turns before the interview state can advance."""

    def classify(
        self,
        *,
        question_id: str,
        transcript: str,
        occurred_at: datetime,
    ) -> CandidateTurn:
        decision = self._decision(transcript)
        return CandidateTurn(
            question_id=question_id,
            transcript=transcript,
            is_complete=decision.is_complete,
            repeat_requested=decision.repeat_requested,
            wait_requested=decision.wait_requested,
            skip_requested=decision.skip_requested,
            candidate_intent=decision.intent,
            is_answer_to_active_question=decision.is_answer_to_active_question,
            classifier_reason=decision.reason,
            started_at=occurred_at,
            ended_at=occurred_at,
        )

    def _decision(self, transcript: str) -> CandidateTurnDecision:
        normalized = _normalize_candidate_text(transcript)
        if not normalized:
            return CandidateTurnDecision(
                intent=CandidateTurnIntent.SILENCE,
                is_answer_to_active_question=False,
                is_complete=False,
                reason="empty_transcript",
            )

        if _contains_any(
            normalized,
            [
                "une seconde",
                "un instant",
                "attendez",
                "laissez moi",
                "laisse moi",
                "un moment",
                "petit moment",
                "donnez moi un moment",
                "wait",
                "hold on",
            ],
        ):
            return CandidateTurnDecision(
                intent=CandidateTurnIntent.WAIT_REQUEST,
                is_answer_to_active_question=False,
                is_complete=False,
                wait_requested=True,
                reason="candidate_requested_time",
            )

        if _contains_any(
            normalized,
            [
                "je passe",
                "je prefere passer",
                "je préfère passer",
                "question suivante",
                "skip",
                "next question",
            ],
        ):
            return CandidateTurnDecision(
                intent=CandidateTurnIntent.PASS,
                is_answer_to_active_question=False,
                is_complete=True,
                skip_requested=True,
                reason="candidate_requested_skip",
            )

        if _contains_any(
            normalized,
            [
                "je n entends",
                "j entends pas",
                "je vous entends pas",
                "probleme technique",
                "probleme de son",
                "probleme de micro",
                "mon micro",
                "le micro",
                "ça coupe",
                "ca coupe",
                "i cannot hear",
                "i can t hear",
            ],
        ):
            return self._non_answer_repeat(
                CandidateTurnIntent.TECHNICAL_ISSUE,
                "candidate_reported_technical_issue",
            )

        if _contains_any(
            normalized,
            [
                "quel poste",
                "quelle poste",
                "titre du poste",
                "c est quoi le poste",
                "c est quoi le titre",
                "on parle de quel",
                "quel role",
                "quelle role",
                "which role",
                "what role",
                "what job",
            ],
        ):
            return self._non_answer_repeat(
                CandidateTurnIntent.CLARIFY_ROLE,
                "candidate_requested_role_context",
            )

        if _is_example_request(normalized):
            return self._non_answer_repeat(
                CandidateTurnIntent.EXAMPLE_REQUEST,
                "candidate_requested_examples",
            )

        if _contains_any(
            normalized,
            [
                "reformuler",
                "rephrase",
                "autrement",
                "pas compris la question",
                "je n ai pas compris",
                "j ai pas compris",
                "tu veux dire quoi",
                "vous voulez dire quoi",
                "what do you mean",
            ],
        ):
            return self._non_answer_repeat(
                CandidateTurnIntent.REFORMULATE_REQUEST,
                "candidate_requested_reformulation",
            )

        if _contains_any(
            normalized,
            [
                "repeter",
                "répéter",
                "repeat",
                "pas entendu",
                "j ai pas entendu",
                "je n ai pas entendu",
                "encore une fois",
            ],
        ):
            return self._non_answer_repeat(
                CandidateTurnIntent.REPEAT_REQUEST,
                "candidate_requested_repeat",
            )

        if _looks_like_partial_answer(normalized):
            return CandidateTurnDecision(
                intent=CandidateTurnIntent.ANSWER_PARTIAL,
                is_answer_to_active_question=True,
                is_complete=False,
                reason="answer_too_short_or_generic",
            )

        return CandidateTurnDecision(
            intent=CandidateTurnIntent.ANSWER_COMPLETE,
            is_answer_to_active_question=True,
            is_complete=True,
            reason="candidate_answered_active_question",
        )

    def _non_answer_repeat(
        self,
        intent: CandidateTurnIntent,
        reason: str,
    ) -> CandidateTurnDecision:
        return CandidateTurnDecision(
            intent=intent,
            is_answer_to_active_question=False,
            is_complete=False,
            repeat_requested=True,
            reason=reason,
        )


def _normalize_candidate_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
    without_punctuation = re.sub(r"[^a-z0-9\s]", " ", without_accents)
    return re.sub(r"\s+", " ", without_punctuation).strip()


def _contains_any(value: str, markers: list[str]) -> bool:
    normalized_markers = [_normalize_candidate_text(marker) for marker in markers]
    return any(marker in value for marker in normalized_markers)


def _looks_like_partial_answer(normalized: str) -> bool:
    words = normalized.split()
    if len(words) <= 2 and normalized in {
        "oui",
        "non",
        "un peu",
        "peut etre",
        "maybe",
        "yes",
        "no",
    }:
        return True
    return normalized in {
        "je ne sais pas",
        "je sais pas",
        "pas vraiment",
        "not really",
    }


def _is_example_request(normalized: str) -> bool:
    if "exemple" not in normalized and "example" not in normalized:
        return False
    return _contains_any(
        normalized,
        [
            "donne moi un exemple",
            "donne moi des exemples",
            "donner un exemple",
            "donner des exemples",
            "tu peux me donner",
            "vous pouvez me donner",
            "peux tu me donner",
            "pouvez vous me donner",
            "can you give",
            "could you give",
        ],
    )


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
        candidate_transcript_handler: Callable[[str, datetime], Awaitable[None]]
        | None = None,
        question_id_provider: Callable[[], str | None] | None = None,
        emit_state_events: bool = True,
    ) -> None:
        self._emitter = emitter
        self._candidate_transcript_handler = candidate_transcript_handler
        self._question_id_provider = question_id_provider
        self._emit_state_events = emit_state_events
        self._tasks: set[asyncio.Task[None]] = set()
        self._assistant_turns = 0
        self._candidate_turns = 0
        self._agent_state_turns = 0
        self._candidate_speaking = False
        self._candidate_activity_seen = False

    def register(self, session: object) -> None:
        on = getattr(session, "on")

        @on("agent_state_changed")
        def on_agent_state_changed(event: object) -> None:
            old_state = getattr(event, "old_state", None)
            new_state = getattr(event, "new_state", None)
            created_at = _created_at(event)
            if not self._emit_state_events:
                return
            if new_state == "speaking":
                self._agent_state_turns += 1
                self._schedule(
                    self._emitter.emit(
                        EventType.AGENT_SPEECH_STARTED,
                        self._agent_signal_payload(self._agent_state_turns),
                        actor=EventActor.AGENT,
                        occurred_at=created_at,
                    )
                )
            elif old_state == "speaking":
                self._schedule(
                    self._emitter.emit(
                        EventType.AGENT_SPEECH_COMPLETED,
                        self._agent_signal_payload(self._agent_state_turns),
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
                payload = {"source": "livekit_agent_session"}
                if question_id := self._current_question_id():
                    payload["question_id"] = question_id
                self._schedule(
                    self._emitter.emit(
                        EventType.CANDIDATE_SPEECH_STARTED,
                        payload,
                        actor=EventActor.CANDIDATE,
                        occurred_at=created_at,
                    )
                )
            elif old_state == "speaking":
                self._candidate_speaking = False
                payload = {"source": "livekit_agent_session"}
                if question_id := self._current_question_id():
                    payload["question_id"] = question_id
                self._schedule(
                    self._emitter.emit(
                        EventType.CANDIDATE_SPEECH_STOPPED,
                        payload,
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
            if self._candidate_transcript_handler is not None:
                self._schedule(self._candidate_transcript_handler(transcript, created_at))
                return

            question_id = self._current_question_id() or "unscoped_livekit"
            turn_id = f"{self._emitter._session_id}:candidate:{self._candidate_turns}"
            self._schedule(
                self._emitter.emit(
                    EventType.CANDIDATE_TURN_FINALIZED,
                    {
                        "question_id": question_id,
                        "completion_reason": "answered",
                        "transcript_turn": {
                            "turn_id": turn_id,
                            "session_id": self._emitter._session_id,
                            "question_id": question_id,
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
            question_id = self._current_question_id()
            payload = {
                **self._agent_signal_payload(self._assistant_turns),
                "transcript_turn": {
                    "turn_id": turn_id,
                    "session_id": self._emitter._session_id,
                    "speaker": "interviewer",
                    "text": text,
                    "is_final": True,
                    "started_at": created_at.isoformat(),
                    "ended_at": created_at.isoformat(),
                },
            }
            if question_id:
                payload["transcript_turn"]["question_id"] = question_id
            self._schedule(
                self._emitter.emit(
                    EventType.AGENT_SPEECH_COMPLETED,
                    payload,
                    actor=EventActor.AGENT,
                    occurred_at=created_at,
                )
            )

        @on("error")
        def on_error(event: object) -> None:
            self._schedule(
                self._emitter.emit(
                    EventType.SESSION_FAILED,
                    {
                        "code": "livekit_agent_session_error",
                        "message": (
                            "LiveKit agent session failed: "
                            f"{getattr(event, 'error', event).__class__.__name__}"
                        ),
                        "retryable": True,
                    },
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

    def _current_question_id(self) -> str | None:
        if self._question_id_provider is None:
            return None
        question_id = self._question_id_provider()
        return question_id or None

    def _agent_signal_payload(self, turn_index: int) -> dict[str, object]:
        question_id = self._current_question_id()
        utterance_kind = "question" if question_id else "intro"
        utterance_scope = question_id or "unscoped"
        payload: dict[str, object] = {
            "source": "livekit_agent_session",
            "utterance_id": (
                f"{self._emitter._session_id}:livekit:{utterance_scope}:{turn_index}"
            ),
            "utterance_kind": utterance_kind,
        }
        if question_id:
            payload["question_id"] = question_id
        return payload

    def _schedule(self, awaitable: Awaitable[None]) -> None:
        task = asyncio.create_task(awaitable)
        self._tasks.add(task)


class LiveInterviewOrchestrationController:
    def __init__(
        self,
        *,
        plan: InterviewPlan,
        emitter: PreludeEventEmitter,
        session: object,
    ) -> None:
        self._plan = plan
        self._emitter = emitter
        self._session = session
        self._orchestrator = InterviewOrchestrator(plan)
        self._lock = asyncio.Lock()
        self._candidate_turns = 0
        self._last_candidate_intent = CandidateTurnIntent.ANSWER_COMPLETE
        self._terminal = False
        self._closed = asyncio.Event()

    async def start(self) -> None:
        command = self._orchestrator.start()
        await self._execute_question_command(command, first=True)

    async def wait_closed(self) -> None:
        await self._closed.wait()

    @property
    def current_question_id(self) -> str | None:
        return self._orchestrator.current_question_id

    async def handle_candidate_transcript(
        self,
        transcript: str,
        occurred_at: datetime,
    ) -> None:
        async with self._lock:
            if self._terminal or self._orchestrator.current_question_id is None:
                return

            question_id = self._orchestrator.current_question_id
            turn = _candidate_turn_from_live_transcript(
                question_id=question_id,
                transcript=transcript,
                occurred_at=occurred_at,
            )
            self._candidate_turns += 1
            turn_id = f"{self._emitter._session_id}:candidate:{self._candidate_turns}"
            await self._emit_candidate_turn(turn, turn_id, occurred_at)
            await self._evaluate_and_execute(turn, [turn_id])

    async def handle_initial_silence(self) -> None:
        async with self._lock:
            if self._terminal or self._orchestrator.current_question_id is None:
                return

            question_id = self._orchestrator.current_question_id
            occurred_at = datetime.now(timezone.utc)
            turn = CandidateTurn(
                question_id=question_id,
                transcript="",
                is_complete=False,
                started_at=occurred_at,
                ended_at=occurred_at,
            )
            self._candidate_turns += 1
            turn_id = f"{self._emitter._session_id}:candidate:{self._candidate_turns}"
            await self._emit_candidate_turn(turn, turn_id, occurred_at)
            await self._evaluate_and_execute(turn, [turn_id])

    async def _emit_candidate_turn(
        self,
        turn: CandidateTurn,
        turn_id: str,
        occurred_at: datetime,
    ) -> None:
        await self._emitter.emit(
            EventType.CANDIDATE_TURN_FINALIZED,
            {
                "question_id": turn.question_id,
                "completion_reason": _candidate_turn_completion_reason(turn),
                "candidate_intent": turn.candidate_intent.value,
                "is_answer_to_active_question": turn.is_answer_to_active_question,
                "classifier_reason": turn.classifier_reason,
                "transcript_turn": {
                    "turn_id": turn_id,
                    "session_id": self._emitter._session_id,
                    "question_id": turn.question_id,
                    "speaker": "candidate",
                    "text": turn.transcript or "[no audible response]",
                    "is_final": True,
                    "started_at": turn.started_at.isoformat(),
                    "ended_at": turn.ended_at.isoformat(),
                },
            },
            actor=EventActor.CANDIDATE,
            occurred_at=occurred_at,
        )

    async def _evaluate_and_execute(
        self,
        turn: CandidateTurn,
        turn_ids: list[str],
    ) -> None:
        self._last_candidate_intent = turn.candidate_intent
        classification = InterviewOrchestrator.classify_candidate_turn(turn)
        decision = self._orchestrator.evaluate_answer(
            classification=classification,
            turn_ids=turn_ids,
            reason_codes=_reason_codes(classification, turn),
            confidence=1.0,
        )
        await self._emitter.emit(
            EventType.ANSWER_EVALUATED,
            decision.answer_evaluation.to_payload(),
            actor=EventActor.SYSTEM,
        )
        await self._execute_decision_command(decision.commands[0])

    async def _execute_decision_command(self, command: OrchestratorCommand) -> None:
        if command.type == OrchestratorCommandType.WAIT:
            await self._emitter.emit(
                EventType.WAIT_REQUESTED,
                {
                    "question_id": command.question_id,
                    "reason": "candidate_requested_time",
                },
                actor=EventActor.CANDIDATE,
            )
            return

        if command.type == OrchestratorCommandType.REPEAT_QUESTION:
            current_question = _current_question(self._plan, command)
            repeat_response = _repeat_response_for_candidate_intent(
                plan=self._plan,
                question_prompt=current_question.prompt,
                intent=self._last_candidate_intent,
            )
            await self._speak_question_control(
                EventType.QUESTION_REPEATED,
                command=command,
                utterance_kind="repeat",
                prompt=repeat_response.prompt,
                instructions=repeat_response.instructions,
                extra_payload={
                    "reason": repeat_response.reason,
                    "candidate_intent": self._last_candidate_intent.value,
                },
            )
            return

        if command.type == OrchestratorCommandType.SOFT_REPROMPT:
            reprompts_used = command.reprompts_used or 1
            await self._speak_question_control(
                EventType.SOFT_REPROMPTED,
                command=command,
                utterance_kind="soft_reprompt",
                prompt="Je n'ai pas assez d'elements. Pouvez-vous preciser en une ou deux phrases ?",
                instructions=(
                    "The candidate answer was incomplete or silent. Ask one brief, warm "
                    "clarification prompt. Do not move to the next question."
                ),
                extra_payload={
                    "reprompts_used": reprompts_used,
                    "attempt_index": command.attempt_index,
                },
            )
            return

        if command.type == OrchestratorCommandType.ASK_FOLLOWUP:
            question = _current_question(self._plan, command)
            followup = question.follow_up_prompt or "Pouvez-vous donner un exemple concret ?"
            followups_used = command.followups_used or 1
            await self._speak_question_control(
                EventType.FOLLOWUP_ASKED,
                command=command,
                utterance_kind="followup",
                prompt=followup,
                instructions=f"Ask only this follow-up question: {followup}",
                extra_payload={
                    "followup_id": f"{command.question_id}:followup:{followups_used}",
                    "followups_used": followups_used,
                    "attempt_index": command.attempt_index,
                },
            )
            return

        if command.type != OrchestratorCommandType.COMPLETE_QUESTION:
            raise RuntimeError(f"unsupported live orchestration command {command.type.value}")

        completion_reason = command.completion_reason or "answered"
        await self._emitter.emit(
            EventType.QUESTION_COMPLETED,
            {
                "question_id": command.question_id,
                "completion_reason": completion_reason,
                "attempt_index": command.attempt_index,
            },
            actor=EventActor.AGENT,
        )
        next_command = self._orchestrator.mark_question_completed(
            command.question_id or "",
            completion_reason,
        )
        if next_command.type == OrchestratorCommandType.ASK_QUESTION:
            await self._execute_question_command(next_command)
        elif next_command.type == OrchestratorCommandType.CLOSE_SESSION:
            await self._close_session(next_command)

    async def _execute_question_command(
        self,
        command: OrchestratorCommand,
        *,
        first: bool = False,
    ) -> None:
        question = _current_question(self._plan, command)
        await self._speak_question_control(
            EventType.QUESTION_ASKED,
            command=command,
            utterance_kind="question",
            prompt=question.prompt,
            instructions=FIRST_REPLY_INSTRUCTIONS
            if first
            else f"Ask only this planned question: {question.prompt}",
            extra_payload={
                "question_index": command.question_index,
                "category": question.category.value,
            },
        )
        self._orchestrator.mark_question_asked(question.id)

    async def _speak_question_control(
        self,
        event_type: EventType,
        *,
        command: OrchestratorCommand,
        utterance_kind: str,
        prompt: str,
        instructions: str,
        extra_payload: dict[str, object] | None = None,
    ) -> None:
        utterance_id = (
            f"{command.question_id}:live-openai:{utterance_kind}:"
            f"{command.attempt_index or command.question_index or 0}"
        )
        await self._emitter.emit(
            EventType.AGENT_SPEECH_STARTED,
            {
                "question_id": command.question_id,
                "utterance_id": utterance_id,
                "utterance_kind": utterance_kind,
            },
            actor=EventActor.AGENT,
        )
        await self._emitter.emit(
            event_type,
            {
                "question_id": command.question_id,
                "prompt": prompt,
                **(extra_payload or {}),
            },
            actor=EventActor.AGENT,
        )
        reply = getattr(self._session, "generate_reply")(
            instructions=instructions,
            allow_interruptions=True,
        )
        wait_for_playout = getattr(reply, "wait_for_playout", None)
        if callable(wait_for_playout):
            await wait_for_playout()

    async def _close_session(self, command: OrchestratorCommand) -> None:
        self._terminal = True
        closing = "Merci, l'entretien est termine. Le recruteur recevra un resume structure."
        await self._emitter.emit(
            EventType.SESSION_CLOSING,
            {
                "completed_questions": command.completed_questions or 0,
                "total_questions": command.total_questions or len(self._plan.questions),
                "closing": closing,
            },
            actor=EventActor.AGENT,
        )
        self._orchestrator.mark_session_closed()
        reply = getattr(self._session, "generate_reply")(
            instructions=closing,
            allow_interruptions=True,
        )
        wait_for_playout = getattr(reply, "wait_for_playout", None)
        if callable(wait_for_playout):
            await wait_for_playout()
        await self._emitter.emit(
            EventType.SESSION_COMPLETED,
            {
                "completed_reason": command.terminal_reason
                or "all_questions_completed",
                "completed_questions": command.completed_questions or 0,
                "total_questions": command.total_questions or len(self._plan.questions),
            },
            actor=EventActor.AGENT,
        )
        self._closed.set()


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
            controller = LiveInterviewOrchestrationController(
                plan=self._agent_config.interview_plan,
                emitter=emitter,
                session=session,
            )
            bridge = LiveKitAgentEventBridge(
                emitter=emitter,
                candidate_transcript_handler=controller.handle_candidate_transcript,
                question_id_provider=lambda: controller.current_question_id,
                emit_state_events=False,
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

            await controller.start()
            silence_prompt_task = asyncio.create_task(
                _soft_prompt_after_initial_silence(
                    bridge=bridge,
                    threshold_seconds=self._worker_config.soft_prompt_after_seconds,
                    on_initial_silence=controller.handle_initial_silence,
                    emitter=emitter,
                    question_id=self._agent_config.interview_plan.questions[0].id,
                )
            )

            try:
                if self._worker_config.max_duration_seconds:
                    with contextlib.suppress(asyncio.TimeoutError):
                        await asyncio.wait_for(
                            _wait_until_room_disconnected_or_interview_closed(
                                room,
                                controller,
                            ),
                            timeout=self._worker_config.max_duration_seconds,
                        )
                else:
                    await _wait_until_room_disconnected_or_interview_closed(
                        room,
                        controller,
                    )
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
        f"{index}. [{question.category.value}] {_spoken_question_prompt(question.prompt)}"
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

Structured interview style:
{_format_interview_style(plan.interview_style)}

Candidate onboarding:
- Start with one brief orientation sentence before the first question.
- Explain that this is a short first-screening conversation and that the same
  structured process helps every candidate get a consistent interview.
- Do not turn the introduction into product narration.
- Do not repeat the onboarding if the candidate interrupts or if the first
  attempt is partially spoken. Continue with the current planned question.
- Greet once at the beginning only. Do not say "Bonjour", "hello", or equivalent
  again when asking the first planned question.

Role adaptation:
- Use the structured interview style first when adapting vocabulary, pacing,
  and examples.
- If structured style context is missing, infer the interview style from the
  role title, planned questions, language, and any job context available in the
  conversation.
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
- Avoid generic reassurance such as "don't worry" or "rassurez-vous" unless the
  candidate explicitly expresses concern or confusion.
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
- If a planned question already contains a greeting, do not add another greeting
  before reading it.
- A candidate turn is not an answer just because the candidate spoke. If the
  candidate asks for the role, a repeat, a reformulation, examples, help
  understanding the question, or reports a technical issue, treat it as a
  non-answer support request.
- For non-answer support requests, answer briefly, stay on the same active
  planned question, and re-ask that question. Never move to the next question
  after a support request.
- If the candidate asks for examples, give one or two neutral answer angles,
  not a model answer to copy, then re-ask the same question.
- If the candidate asks for time, acknowledge it briefly and wait.
- Close warmly after the planned questions.

Planned questions for speech:
{questions}
"""


def _spoken_question_prompt(prompt: str) -> str:
    spoken = INITIAL_GREETING_RE.sub("", prompt, count=1).strip()
    return spoken or prompt.strip()


def _format_interview_style(style: InterviewStyle) -> str:
    lines = []
    if style.sector:
        lines.append(f"- Sector: {style.sector}")
    if style.seniority:
        lines.append(f"- Seniority: {style.seniority}")
    if style.work_environment:
        lines.append(f"- Work environment: {style.work_environment}")
    if style.role_constraints:
        lines.append(f"- Role constraints: {'; '.join(style.role_constraints)}")
    if style.company_context:
        lines.append(f"- Company context: {style.company_context}")
    if style.candidate_tone:
        lines.append(f"- Candidate tone: {style.candidate_tone}")

    if not lines:
        return "- No structured style context provided. Infer from the role and questions."

    return "\n".join(lines)


def _current_question(plan: InterviewPlan, command: OrchestratorCommand):
    if command.question is not None:
        return command.question
    for question in plan.questions:
        if question.id == command.question_id:
            return question
    raise RuntimeError(f"unknown orchestrator question {command.question_id}")


def _candidate_turn_from_live_transcript(
    *,
    question_id: str,
    transcript: str,
    occurred_at: datetime,
) -> CandidateTurn:
    return CandidateTurnClassifier().classify(
        question_id=question_id,
        transcript=transcript,
        occurred_at=occurred_at,
    )


def _repeat_response_for_candidate_intent(
    *,
    plan: InterviewPlan,
    question_prompt: str,
    intent: CandidateTurnIntent,
) -> CandidateSupportResponse:
    if intent == CandidateTurnIntent.CLARIFY_ROLE:
        return CandidateSupportResponse(
            prompt=f"Le poste est {plan.role_title}. {question_prompt}",
            instructions=(
                f"Briefly clarify that the interview is for {plan.role_title}. "
                "Use only the known role and structured interview context. Do not invent "
                "job details. Then re-ask the current planned question. Do not move to "
                "the next question."
            ),
            reason="candidate_requested_role_context",
        )

    if intent == CandidateTurnIntent.EXAMPLE_REQUEST:
        return CandidateSupportResponse(
            prompt=question_prompt,
            instructions=(
                "The candidate asked for examples, not to answer the question yet. "
                "Give one or two neutral examples of answer angles without giving a "
                "model answer to copy. Keep it concise, then re-ask the same current "
                "planned question. Do not evaluate the request. Do not move to the next "
                "question."
            ),
            reason="candidate_requested_examples",
        )

    if intent == CandidateTurnIntent.REFORMULATE_REQUEST:
        return CandidateSupportResponse(
            prompt=question_prompt,
            instructions=(
                "The candidate asked for a reformulation. Rephrase the same current "
                "planned question in simpler, concrete language. Do not add a new "
                "screening question and do not move to the next question."
            ),
            reason="candidate_requested_reformulation",
        )

    if intent == CandidateTurnIntent.TECHNICAL_ISSUE:
        return CandidateSupportResponse(
            prompt=question_prompt,
            instructions=(
                "The candidate reported an audio or technical issue. Briefly check that "
                "they can hear you now, then repeat the same current planned question. "
                "Do not move to the next question."
            ),
            reason="candidate_reported_technical_issue",
        )

    return CandidateSupportResponse(
        prompt=question_prompt,
        instructions=(
            "Repeat only the current planned question. Do not move to the next question."
        ),
        reason="candidate_requested_repeat",
    )


def _candidate_turn_completion_reason(turn: CandidateTurn) -> str:
    if turn.skip_requested:
        return "skipped"
    if turn.repeat_requested or turn.wait_requested or not turn.is_complete:
        return "incomplete"
    return "answered"


def _reason_codes(
    classification: AnswerClassification,
    turn: CandidateTurn | None = None,
) -> list[str]:
    reason_codes: list[str] = []
    if turn is not None:
        reason_codes.append(f"candidate_intent:{turn.candidate_intent.value}")
        if turn.classifier_reason:
            reason_codes.append(turn.classifier_reason)
    if classification == AnswerClassification.VAGUE:
        reason_codes.append("too_generic")
        return reason_codes
    if classification == AnswerClassification.INCOMPLETE:
        reason_codes.append("incomplete_answer")
        return reason_codes
    if classification == AnswerClassification.SILENT:
        reason_codes.append("candidate_silent")
        return reason_codes
    if classification == AnswerClassification.SKIPPED:
        reason_codes.append("candidate_requested_skip")
        return reason_codes
    if classification == AnswerClassification.REPEAT_REQUESTED:
        reason_codes.append("candidate_requested_repeat")
        return reason_codes
    if classification == AnswerClassification.WAIT_REQUESTED:
        reason_codes.append("candidate_requested_time")
        return reason_codes
    return reason_codes


async def _soft_prompt_after_initial_silence(
    *,
    bridge: LiveKitAgentEventBridge,
    threshold_seconds: float,
    on_initial_silence: Callable[[], Awaitable[None]] | None = None,
    session: object | None = None,
    emitter: PreludeEventEmitter | None = None,
    question_id: str | None = None,
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
    if on_initial_silence is not None and emitter is not None and question_id is not None:
        await emitter.emit(
            EventType.SILENCE_TIMEOUT_STARTED,
            {
                "question_id": question_id,
                "tier": "soft_prompt",
                "threshold_ms": threshold_ms,
            },
            actor=EventActor.SYSTEM,
        )

    if on_initial_silence is not None:
        await on_initial_silence()
        return

    if session is None or emitter is None or question_id is None:
        raise RuntimeError("legacy silence prompt requires session, emitter, and question_id")

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
            create_response=False,
            interrupt_response=True,
            silence_duration_ms=700,
            prefix_padding_ms=300,
        )

    return module.SemanticVad(
        type="semantic_vad",
        create_response=False,
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
    required_events = {
        EventType.CANDIDATE_JOINED,
        EventType.CANDIDATE_MEDIA_READY,
    }
    ready_events: set[EventType] = set()
    while True:
        for event_type in required_events - ready_events:
            if await has_event(session_id, event_type):
                ready_events.add(event_type)
        if ready_events == required_events:
            return
        if asyncio.get_running_loop().time() >= deadline:
            missing_events = sorted(event.value for event in required_events - ready_events)
            raise TimeoutError(
                "candidate readiness events were not received for session "
                f"{session_id}: {', '.join(missing_events)}"
            )
        await asyncio.sleep(poll_interval_seconds)


async def _wait_until_room_disconnected(room: object) -> None:
    while getattr(room, "isconnected")():
        await asyncio.sleep(0.5)


async def _wait_until_room_disconnected_or_interview_closed(
    room: object,
    controller: LiveInterviewOrchestrationController,
) -> None:
    room_task = asyncio.create_task(_wait_until_room_disconnected(room))
    controller_task = asyncio.create_task(controller.wait_closed())
    pending: set[asyncio.Task[None]] = set()
    try:
        done, pending = await asyncio.wait(
            {room_task, controller_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            task.result()
    finally:
        for task in pending:
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.gather(*pending)

    if controller_task.done() and getattr(room, "isconnected")():
        await room.disconnect()


def _created_at(event: object) -> datetime:
    raw = getattr(event, "created_at", None)
    if isinstance(raw, int | float):
        return datetime.fromtimestamp(raw, tz=timezone.utc)
    return datetime.now(timezone.utc)
