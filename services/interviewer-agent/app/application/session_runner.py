from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.application.ports import LiveKitRoomAdapter, ProviderAdapter, RealtimeApiClient
from app.domain.models import (
    AgentLiveKitJoin,
    EventActor,
    EventType,
    InterviewEvent,
    InterviewPlan,
    InterviewQuestion,
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
        self._state_machine = InterviewerStateMachine()
        self._turn_taking = TurnTakingPolicy()
        self._sequence = 0
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

            for question_index, question in enumerate(self._plan.questions):
                await self._run_question(question, question_index)

            closing = await self._provider.close_session()
            await self._emit(
                EventType.SESSION_CLOSING,
                {
                    "completed_questions": len(self._plan.questions),
                    "closing": closing,
                },
            )
            await self._emit(
                EventType.SESSION_COMPLETED,
                {
                    "completed_reason": "all_questions_completed",
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

    async def _run_question(self, question: InterviewQuestion, question_index: int) -> None:
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
            },
        )
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

        followups_used = 0
        soft_reprompts_used = 0
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
                await self._emit_turn_decision(
                    turn_decision,
                    {"question_id": question.id},
                    actor=EventActor.CANDIDATE
                    if turn.wait_requested
                    else EventActor.SYSTEM,
                )
                if turn_decision.action == TurnTakingAction.WAIT:
                    continue
                break

            if turn.repeat_requested:
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

            completion_reason = self._completion_reason(turn)
            await self._emit(
                EventType.CANDIDATE_TURN_FINALIZED,
                {
                    "question_id": question.id,
                    "completion_reason": completion_reason,
                    "transcript_turn": {
                        "turn_id": f"{self._session_id}:{question.id}:{self._sequence + 1}",
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

            if turn.skip_requested:
                await self._complete_question(question.id, "skipped")
                return

            if not turn.is_complete:
                if soft_reprompts_used < 1:
                    soft_reprompts_used += 1
                    reprompt_utterance_id = f"{question.id}:reprompt:{soft_reprompts_used}"
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
                            "reprompts_used": soft_reprompts_used,
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

                await self._complete_question(question.id, "candidate_silent")
                return

            can_follow_up = followups_used < self._plan.max_followups_per_question
            should_follow_up = can_follow_up and await self._provider.should_follow_up(
                question,
                turn,
                followups_used,
                self._plan.max_followups_per_question,
            )
            if not should_follow_up:
                await self._complete_question(question.id, "answered")
                return

            followups_used += 1
            follow_up = await self._provider.ask_follow_up(question)
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

    async def _complete_question(self, question_id: str, completion_reason: str) -> None:
        await self._emit(
            EventType.QUESTION_COMPLETED,
            {
                "question_id": question_id,
                "completion_reason": completion_reason,
            },
        )

    def _completion_reason(self, turn: object) -> str:
        if getattr(turn, "skip_requested", False):
            return "skipped"
        if not getattr(turn, "is_complete", True):
            return "incomplete"
        return "answered"

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
            payload={"error": str(exc), "error_type": exc.__class__.__name__},
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
