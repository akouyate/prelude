from __future__ import annotations

from dataclasses import dataclass

from app.application.ports import LiveKitRoomAdapter, ProviderAdapter, RealtimeApiClient
from app.domain.models import (
    AgentLiveKitJoin,
    EventType,
    InterviewEvent,
    InterviewPlan,
    InterviewQuestion,
)
from app.domain.state_machine import InterviewerStateMachine


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
    ) -> None:
        self._plan = plan
        self._provider = provider
        self._realtime_api = realtime_api
        self._session_id = session_id
        self._livekit_room = livekit_room
        self._livekit_join = livekit_join
        self._provider_name = provider_name
        self._state_machine = InterviewerStateMachine()
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
        await self._emit(
            EventType.QUESTION_ASKED,
            {
                "question_id": question.id,
                "question_index": question_index,
                "prompt": utterance,
                "category": question.category.value,
            },
        )

        followups_used = 0
        soft_reprompts_used = 0
        while True:
            await self._emit(EventType.CANDIDATE_TURN_STARTED, {"question_id": question.id})
            turn = await self._provider.listen_for_answer(question)

            if turn.repeat_requested:
                repeated = await self._provider.ask_question(question)
                await self._emit(
                    EventType.QUESTION_REPEATED,
                    {
                        "question_id": question.id,
                        "prompt": repeated,
                        "reason": "candidate_requested_repeat",
                    },
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
            )

            if turn.skip_requested:
                await self._complete_question(question.id, "skipped")
                return

            if not turn.is_complete:
                if soft_reprompts_used < 1:
                    soft_reprompts_used += 1
                    await self._emit(
                        EventType.SOFT_REPROMPTED,
                        {
                            "question_id": question.id,
                            "prompt": "Je n'ai pas assez d'elements. Pouvez-vous preciser en une ou deux phrases ?",
                            "reprompts_used": soft_reprompts_used,
                        },
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
            await self._emit(
                EventType.FOLLOWUP_ASKED,
                {
                    "question_id": question.id,
                    "followup_id": f"{question.id}:followup:{followups_used}",
                    "prompt": follow_up,
                    "followups_used": followups_used,
                },
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

    async def _emit(self, event_type: EventType, payload: dict[str, object]) -> None:
        self._state_machine.apply(event_type, payload)
        self._sequence += 1
        event = InterviewEvent(
            type=event_type,
            session_id=self._session_id,
            sequence=self._sequence,
            payload=payload,
        )
        await self._realtime_api.emit_event(event)
        self._events_emitted += 1

    async def _emit_failure(self, exc: Exception) -> None:
        try:
            self._state_machine.apply(EventType.SESSION_FAILED)
        except Exception:
            pass

        self._sequence += 1
        event = InterviewEvent(
            type=EventType.SESSION_FAILED,
            session_id=self._session_id,
            sequence=self._sequence,
            payload={"error": str(exc), "error_type": exc.__class__.__name__},
        )
        await self._realtime_api.emit_event(event)
        self._events_emitted += 1
