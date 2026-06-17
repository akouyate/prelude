from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class QuestionCategory(StrEnum):
    MOTIVATION = "motivation"
    EXPERIENCE = "experience"
    LOGISTICS = "logistics"
    ROLE_FIT = "role_fit"


class InterviewQuestion(BaseModel):
    id: str
    prompt: str
    category: QuestionCategory = QuestionCategory.ROLE_FIT
    follow_up_prompt: str | None = None


class InterviewPlan(BaseModel):
    id: str
    role_title: str
    language: str = "fr"
    questions: list[InterviewQuestion] = Field(min_length=1)
    allow_video: bool = True
    allow_audio_only: bool = True
    max_followups_per_question: int = Field(default=1, ge=0, le=2)


class CandidateTurn(BaseModel):
    question_id: str
    transcript: str
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EventType(StrEnum):
    SESSION_STARTED = "session_started"
    QUESTION_ASKED = "question_asked"
    QUESTION_REPEATED = "question_repeated"
    CANDIDATE_TURN_STARTED = "candidate_turn_started"
    CANDIDATE_TURN_FINALIZED = "candidate_turn_finalized"
    FOLLOWUP_ASKED = "followup_asked"
    QUESTION_COMPLETED = "question_completed"
    SESSION_COMPLETED = "session_completed"
    SESSION_FAILED = "session_failed"
    FREE_CHAT_REQUESTED = "free_chat_requested"


class InterviewEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: f"evt_{uuid4().hex}")
    type: EventType
    session_id: str
    sequence: int
    idempotency_key: str = Field(default_factory=lambda: str(uuid4()))
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)


def create_demo_plan() -> InterviewPlan:
    return InterviewPlan(
        id="plan-demo-product-manager",
        role_title="Product Manager B2B SaaS",
        questions=[
            InterviewQuestion(
                id="q1",
                prompt="Bonjour, pouvez-vous vous presenter brievement et expliquer ce qui vous interesse dans ce poste ?",
                category=QuestionCategory.MOTIVATION,
                follow_up_prompt="Qu'est-ce qui vous attire le plus dans ce contexte produit ?",
            ),
            InterviewQuestion(
                id="q2",
                prompt="Parlez-moi d'une experience ou vous avez du prioriser une roadmap avec des contraintes fortes.",
                category=QuestionCategory.EXPERIENCE,
                follow_up_prompt="Quel compromis avez-vous fait et comment l'avez-vous explique aux parties prenantes ?",
            ),
            InterviewQuestion(
                id="q3",
                prompt="Quelles sont vos disponibilites et vos contraintes eventuelles pour la suite du process ?",
                category=QuestionCategory.LOGISTICS,
            ),
        ],
    )
