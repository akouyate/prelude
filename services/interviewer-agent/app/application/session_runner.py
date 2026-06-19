from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.application.ports import LiveKitRoomAdapter, ProviderAdapter, RealtimeApiClient
from app.domain.models import (
    AgentLiveKitJoin,
    CandidateTurn,
    EventActor,
    EventType,
    InterviewEvent,
    InterviewPlan,
    InterviewQuestion,
)
from app.domain.orchestrator import (
    AnswerClassification,
    InterviewOrchestrator,
    OrchestratorCommand,
    OrchestratorCommandType,
)
from app.domain.state_machine import InterviewerStateMachine
from app.domain.turn_taking import (
    InterruptionClassification,
    TurnTakingAction,
    TurnTakingDecision,
    TurnTakingPolicy,
)


@dataclass(frozen=True)
class SessionResult:
    session_id: str
    questions_completed: int
    events_emitted: int


class InterviewSessionRunner:
    def __init__(
        self,
        plan: InterviewPlan,
        provider: ProviderAdapter,
        realtime_api: RealtimeApiClient,
        session_id: str,
        livekit_room: LiveKitRoomAdapter | None = None,
        livekit_join: AgentLiveKitJoin | None = None,
        provider_name: str = "mock",
        simulate_first_question_barge_in: bool = False,
        provider_metadata: dict[str, object] | None = None,
        idempotency_key_prefix: str | None = None,
        initial_sequence: int = 0,
    ) -> None:
        self._plan = plan
        self._provider = provider
        self._realtime_api = realtime_api
        self._session_id = session_id
        self._livekit_room = livekit_room
        self._livekit_join = livekit_join
        self._provider_name = provider_name
        self._simulate_first_question_barge_in = simulate_first_question_barge_in
        self._provider_metadata = {
            "provider": provider_name,
            **(provider_metadata or {}),
        }
        self._idempotency_key_prefix = idempotency_key_prefix
        self._orchestrator = InterviewOrchestrator(plan)
        self._state_machine = InterviewerStateMachine()
        self._turn_taking = TurnTakingPolicy()
        self._sequence = initial_sequence
        self._events_emitted = 0

    async def run(self) -> SessionResult:
        joined_room = False
        try:
            if self._livekit_room and self._livekit_join:
                await self._livekit_room.join(self._livekit_join)
                joined_room = True
                await self._emit(
                    EventType.AGENT_JOINED,
                    {
                        "agent_participant_id": self._livekit_join.participant,
                        "provider": self._provider_name,
                        "room_name": self._livekit_join.room_name,
                    },
                )

            intro = await self._provider.start_session(self._plan)
            await self._emit(
                EventType.SESSION_STARTED,
                {
                    "plan_id": self._plan.id,
                    "intro": intro,
                    "provider": self._provider_name,
                    "agent_participant_id": self._livekit_join.participant if self._livekit_join else "local-agent",
                },
            )

            command = self._orchestrator.start()
            while command.type == OrchestratorCommandType.ASK_QUESTION:
                if command.question is None or command.question_index is None:
                    raise RuntimeError("orchestrator returned an incomplete ask_question command")
                command = await self._run_question(
                    command.question,
                    command.question_index,
                )

            if command.type != OrchestratorCommandType.CLOSE_SESSION:
                raise RuntimeError(f"unexpected terminal command {command.type.value}")

            closing = await self._provider.close_session()
            await self._emit(
                EventType.SESSION_CLOSING,
                {
                    "completed_questions": command.completed_questions or 0,
                    "total_questions": command.total_questions or len(self._plan.questions),
                    "closing": closing,
                    "transcript_turn": self._interviewer_transcript_turn(
                        question_id=None,
                        turn_id="closing",
                        text=closing,
                    ),
                },
            )
            self._orchestrator.mark_session_closed()
            await self._emit(
                EventType.SESSION_COMPLETED,
                {
                    "completed_reason": command.terminal_reason
                    or "all_questions_completed",
                    "completed_questions": command.completed_questions or 0,
                    "total_questions": command.total_questions or len(self._plan.questions),
                    "closing": closing,
                },
            )
            return SessionResult(
                session_id=self._session_id,
                questions_completed=len(self._plan.questions),
                events_emitted=self._events_emitted,
            )
        except Exception as exc:
            await self._emit_failure(exc)
            raise
        finally:
            if joined_room and self._livekit_room:
                await self._livekit_room.disconnect()

    async def _run_question(
        self,
        question: InterviewQuestion,
        question_index: int,
    ) -> OrchestratorCommand:
        utterance = await self._provider.ask_question(question)
        utterance_id = f"{question.id}:question:{question_index}"
        await self._emit_turn_decision(
            self._turn_taking.agent_speech_started(
                question_id=question.id,
                utterance_kind="question",
            ),
            {
                "question_id": question.id,
                "utterance_id": utterance_id,
                "utterance_kind": "question",
            },
            actor=EventActor.AGENT,
        )
        await self._emit(
            EventType.QUESTION_ASKED,
            {
                "question_id": question.id,
                "question_index": question_index,
                "prompt": utterance,
                "category": question.category.value,
                "transcript_turn": self._interviewer_transcript_turn(
                    question_id=question.id,
                    turn_id=f"{question.id}:question:{question_index}",
                    text=utterance,
                ),
            },
        )
        self._orchestrator.mark_question_asked(question.id)
        if self._simulate_first_question_barge_in and question_index == 0:
            await self._emit_mock_barge_in(question.id, utterance_id)
        else:
            await self._emit_turn_decision(
                self._turn_taking.agent_speech_completed(question_id=question.id),
                {
                    "question_id": question.id,
                    "utterance_id": utterance_id,
                    "utterance_kind": "question",
                },
                actor=EventActor.AGENT,
            )

        while True:
            await self._emit(
                EventType.CANDIDATE_TURN_STARTED,
                {"question_id": question.id},
                actor=EventActor.CANDIDATE,
            )
            while True:
                await self._emit_turn_decision(
                    self._turn_taking.candidate_speech_started(question_id=question.id),
                    {"question_id": question.id},
                    actor=EventActor.CANDIDATE,
                )
                turn = await self._provider.listen_for_answer(question)
                await self._emit_turn_decision(
                    self._turn_taking.candidate_speech_stopped(question_id=question.id),
                    {"question_id": question.id},
                    actor=EventActor.CANDIDATE,
                )
                await self._emit_turn_decision(
                    self._turn_taking.candidate_turn_detected(
                        question_id=question.id,
                        stable_silence_ms=self._turn_taking.config.vad_end_silence_ms,
                        semantic_complete=turn.is_complete,
                    ),
                    {
                        "question_id": question.id,
                        "stable_silence_ms": self._turn_taking.config.vad_end_silence_ms,
                        "semantic_complete": turn.is_complete,
                    },
                    actor=EventActor.SYSTEM,
                )

                turn_decision = self._turn_taking.evaluate_candidate_turn(turn)
                if turn_decision.action != TurnTakingAction.WAIT:
                    await self._emit_turn_decision(
                        turn_decision,
                        {"question_id": question.id},
                        actor=EventActor.SYSTEM,
                    )
                break

            turn_id = f"{self._session_id}:{question.id}:{self._sequence + 1}"
            await self._emit(
                EventType.CANDIDATE_TURN_FINALIZED,
                {
                    "question_id": question.id,
                    "completion_reason": self._completion_reason(turn),
                    "transcript_turn": {
                        "turn_id": turn_id,
                        "session_id": self._session_id,
                        "question_id": question.id,
                        "speaker": "candidate",
                        "text": turn.transcript or "[no audible response]",
                        "is_final": True,
                        "started_at": turn.started_at.isoformat(),
                        "ended_at": turn.ended_at.isoformat(),
                    },
                },
                actor=EventActor.CANDIDATE,
            )

            classification = await self._classify_answer(question, turn)
            decision = self._orchestrator.evaluate_answer(
                classification=classification,
                turn_ids=[turn_id],
                reason_codes=self._reason_codes(classification),
                confidence=1.0,
            )
            await self._emit(
                EventType.ANSWER_EVALUATED,
                decision.answer_evaluation.to_payload(),
                actor=EventActor.SYSTEM,
            )
            command = decision.commands[0]

            if command.type == OrchestratorCommandType.WAIT:
                await self._emit(
                    EventType.WAIT_REQUESTED,
                    {
                        "question_id": question.id,
                        "reason": "candidate_requested_time",
                    },
                    actor=EventActor.CANDIDATE,
                )
                continue

            if command.type == OrchestratorCommandType.REPEAT_QUESTION:
                repeated = await self._provider.ask_question(question)
                repeat_utterance_id = f"{question.id}:repeat:{self._sequence + 1}"
                await self._emit_turn_decision(
                    self._turn_taking.agent_speech_started(
                        question_id=question.id,
                        utterance_kind="repeat",
                    ),
                    {
                        "question_id": question.id,
                        "utterance_id": repeat_utterance_id,
                        "utterance_kind": "repeat",
                    },
                    actor=EventActor.AGENT,
                )
                await self._emit(
                    EventType.QUESTION_REPEATED,
                    {
                        "question_id": question.id,
                        "prompt": repeated,
                        "reason": "candidate_requested_repeat",
                        "transcript_turn": self._interviewer_transcript_turn(
                            question_id=question.id,
                            turn_id=repeat_utterance_id,
                            text=repeated,
                        ),
                    },
                )
                await self._emit_turn_decision(
                    self._turn_taking.agent_speech_completed(question_id=question.id),
                    {
                        "question_id": question.id,
                        "utterance_id": repeat_utterance_id,
                        "utterance_kind": "repeat",
                    },
                    actor=EventActor.AGENT,
                )
                continue

            if command.type == OrchestratorCommandType.SOFT_REPROMPT:
                reprompts_used = command.reprompts_used or 1
                reprompt_utterance_id = f"{question.id}:reprompt:{reprompts_used}"
                await self._emit_turn_decision(
                    self._turn_taking.agent_speech_started(
                        question_id=question.id,
                        utterance_kind="soft_reprompt",
                    ),
                    {
                        "question_id": question.id,
                        "utterance_id": reprompt_utterance_id,
                        "utterance_kind": "soft_reprompt",
                    },
                    actor=EventActor.AGENT,
                )
                await self._emit(
                    EventType.SOFT_REPROMPTED,
                    {
                        "question_id": question.id,
                        "prompt": "Je n'ai pas assez d'elements. Pouvez-vous preciser en une ou deux phrases ?",
                        "reprompts_used": reprompts_used,
                        "attempt_index": command.attempt_index,
                        "transcript_turn": self._interviewer_transcript_turn(
                            question_id=question.id,
                            turn_id=reprompt_utterance_id,
                            text="Je n'ai pas assez d'elements. Pouvez-vous preciser en une ou deux phrases ?",
                        ),
                    },
                )
                await self._emit_turn_decision(
                    self._turn_taking.agent_speech_completed(question_id=question.id),
                    {
                        "question_id": question.id,
                        "utterance_id": reprompt_utterance_id,
                        "utterance_kind": "soft_reprompt",
                    },
                    actor=EventActor.AGENT,
                )
                continue

            if command.type == OrchestratorCommandType.COMPLETE_QUESTION:
                completion_reason = command.completion_reason or "answered"
                await self._complete_question(
                    question.id,
                    completion_reason,
                    attempt_index=command.attempt_index,
                )
                return self._orchestrator.mark_question_completed(
                    question.id,
                    completion_reason,
                )

            if command.type != OrchestratorCommandType.ASK_FOLLOWUP:
                raise RuntimeError(f"unsupported orchestrator command {command.type.value}")

            follow_up = await self._provider.ask_follow_up(question)
            followups_used = command.followups_used or 1
            followup_utterance_id = f"{question.id}:followup:{followups_used}"
            await self._emit_turn_decision(
                self._turn_taking.agent_speech_started(
                    question_id=question.id,
                    utterance_kind="followup",
                ),
                {
                    "question_id": question.id,
                    "utterance_id": followup_utterance_id,
                    "utterance_kind": "followup",
                },
                actor=EventActor.AGENT,
            )
            await self._emit(
                EventType.FOLLOWUP_ASKED,
                {
                    "question_id": question.id,
                    "followup_id": followup_utterance_id,
                    "prompt": follow_up,
                    "followups_used": followups_used,
                    "attempt_index": command.attempt_index,
                    "transcript_turn": self._interviewer_transcript_turn(
                        question_id=question.id,
                        turn_id=followup_utterance_id,
                        text=follow_up,
                    ),
                },
            )
            await self._emit_turn_decision(
                self._turn_taking.agent_speech_completed(question_id=question.id),
                {
                    "question_id": question.id,
                    "utterance_id": followup_utterance_id,
                    "utterance_kind": "followup",
                },
                actor=EventActor.AGENT,
            )

    async def _complete_question(
        self,
        question_id: str,
        completion_reason: str,
        *,
        attempt_index: int | None,
    ) -> None:
        await self._emit(
            EventType.QUESTION_COMPLETED,
            {
                "question_id": question_id,
                "completion_reason": completion_reason,
                "attempt_index": attempt_index,
            },
        )

    async def _classify_answer(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
    ) -> AnswerClassification:
        classification = InterviewOrchestrator.classify_candidate_turn(turn)
        if classification != AnswerClassification.COMPLETE:
            return classification

        should_follow_up = await self._provider.should_follow_up(
            question,
            turn,
            self._orchestrator.followups_used(question.id),
            self._plan.max_followups_per_question,
        )
        if should_follow_up:
            return AnswerClassification.VAGUE

        return AnswerClassification.COMPLETE

    def _reason_codes(self, classification: AnswerClassification) -> list[str]:
        if classification == AnswerClassification.VAGUE:
            return ["too_generic"]
        if classification == AnswerClassification.INCOMPLETE:
            return ["incomplete_answer"]
        if classification == AnswerClassification.SILENT:
            return ["candidate_silent"]
        if classification == AnswerClassification.SKIPPED:
            return ["candidate_requested_skip"]
        if classification == AnswerClassification.REPEAT_REQUESTED:
            return ["candidate_requested_repeat"]
        if classification == AnswerClassification.WAIT_REQUESTED:
            return ["candidate_requested_time"]
        return []

    def _completion_reason(self, turn: object) -> str:
        if getattr(turn, "skip_requested", False):
            return "skipped"
        if getattr(turn, "repeat_requested", False) or getattr(
            turn,
            "wait_requested",
            False,
        ):
            return "incomplete"
        if not getattr(turn, "is_complete", True):
            return "incomplete"
        return "answered"

    def _interviewer_transcript_turn(
        self,
        *,
        question_id: str | None,
        turn_id: str,
        text: str,
    ) -> dict[str, object]:
        occurred_at = self._occurred_at().isoformat()
        transcript_turn: dict[str, object] = {
            "turn_id": f"{self._session_id}:interviewer:{turn_id}",
            "session_id": self._session_id,
            "speaker": "interviewer",
            "text": text,
            "is_final": True,
            "started_at": occurred_at,
            "ended_at": occurred_at,
        }
        if question_id:
            transcript_turn["question_id"] = question_id
        return transcript_turn

    async def _emit(
        self,
        event_type: EventType,
        payload: dict[str, object] | None = None,
        *,
        actor: EventActor = EventActor.AGENT,
        apply_state: bool = True,
    ) -> None:
        payload = payload or {}
        if apply_state:
            self._state_machine.apply(event_type, payload)
        self._sequence += 1
        event = InterviewEvent(
            event_id=self._event_id(event_type),
            type=event_type,
            actor=actor,
            session_id=self._session_id,
            sequence=self._sequence,
            idempotency_key=self._idempotency_key(event_type),
            occurred_at=self._occurred_at(),
            payload=payload,
            provider_metadata=dict(self._provider_metadata),
        )
        await self._realtime_api.emit_event(event)
        self._events_emitted += 1

    async def _emit_turn_decision(
        self,
        decision: TurnTakingDecision,
        payload: dict[str, object],
        *,
        actor: EventActor,
    ) -> None:
        for event_type in decision.events:
            event_payload = dict(payload)
            if decision.reason:
                event_payload["reason"] = decision.reason
            if decision.cancel_agent_audio:
                event_payload["cancel_agent_audio"] = True
            await self._emit(
                event_type,
                event_payload,
                actor=actor,
                apply_state=False,
            )

    async def _emit_mock_barge_in(self, question_id: str, utterance_id: str) -> None:
        base_payload = {
            "question_id": question_id,
            "utterance_id": utterance_id,
            "overlap_ms": 340,
            "candidate_speech_ms": 340,
            "confidence": 0.92,
        }
        await self._emit_turn_decision(
            self._turn_taking.candidate_speech_started(question_id=question_id),
            base_payload,
            actor=EventActor.CANDIDATE,
        )
        await self._emit_turn_decision(
            self._turn_taking.classify_interruption(
                question_id=question_id,
                candidate_audio_ms=340,
                classification=InterruptionClassification.INTERRUPTION,
            ),
            {
                **base_payload,
                "cancel_latency_ms": 120,
                "truncated_at_ms": 340,
            },
            actor=EventActor.SYSTEM,
        )

    async def _emit_failure(self, exc: Exception) -> None:
        try:
            self._state_machine.apply(EventType.SESSION_FAILED)
        except Exception:
            pass

        self._sequence += 1
        event = InterviewEvent(
            event_id=self._event_id(EventType.SESSION_FAILED),
            type=EventType.SESSION_FAILED,
            session_id=self._session_id,
            sequence=self._sequence,
            idempotency_key=self._idempotency_key(EventType.SESSION_FAILED),
            occurred_at=self._occurred_at(),
            payload={
                "code": "agent_runtime_error",
                "message": f"Interview agent failed: {exc.__class__.__name__}",
                "retryable": False,
            },
            provider_metadata=dict(self._provider_metadata),
        )
        await self._realtime_api.emit_event(event)
        self._events_emitted += 1

    def _idempotency_key(self, event_type: EventType) -> str:
        if not self._idempotency_key_prefix:
            return str(uuid4())
        return f"{self._idempotency_key_prefix}:{self._sequence}:{event_type.value}"

    def _event_id(self, event_type: EventType) -> str:
        if not self._idempotency_key_prefix:
            return f"evt_{uuid4().hex}"
        return f"evt_{self._idempotency_key_prefix}:{self._sequence}:{event_type.value}"

    def _occurred_at(self) -> datetime:
        if not self._idempotency_key_prefix:
            return datetime.now(timezone.utc)
        return datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(
            milliseconds=self._sequence
        )
