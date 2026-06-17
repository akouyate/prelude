from __future__ import annotations

from typing import Protocol

from app.domain.models import CandidateTurn, InterviewEvent, InterviewPlan, InterviewQuestion


class ProviderAdapter(Protocol):
    async def start_session(self, plan: InterviewPlan) -> str:
        """Prepare the voice provider session and return the intro text."""

    async def ask_question(self, question: InterviewQuestion) -> str:
        """Return the interviewer utterance for a planned question."""

    async def listen_for_answer(self, question: InterviewQuestion) -> CandidateTurn:
        """Return a finalized candidate turn for the current question."""

    async def should_follow_up(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
        followups_used: int,
        max_followups: int,
    ) -> bool:
        """Decide whether a single controlled follow-up is needed."""

    async def ask_follow_up(self, question: InterviewQuestion) -> str:
        """Return the interviewer utterance for a follow-up."""

    async def close_session(self) -> str:
        """Return a closing utterance."""


class RealtimeApiClient(Protocol):
    async def emit_event(self, event: InterviewEvent) -> None:
        """Publish an event to the Go realtime API or a local sink."""

