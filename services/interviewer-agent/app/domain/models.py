from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class QuestionCategory(StrEnum):
    MOTIVATION = "motivation"
    EXPERIENCE = "experience"
    LOGISTICS = "logistics"
    ROLE_FIT = "role_fit"


class InterviewQuestion(BaseModel):
    id: str
    prompt: str
    category: QuestionCategory = QuestionCategory.ROLE_FIT
    # The recruiter-authored evaluation signal the interviewer should probe for.
    expected_signal: str | None = None
    follow_up_prompt: str | None = None


class InterviewStyle(BaseModel):
    sector: str | None = None
    seniority: str | None = None
    work_environment: str | None = None
    role_constraints: list[str] = Field(default_factory=list)
    company_context: str | None = None
    candidate_tone: str | None = None


class InterviewPlan(BaseModel):
    id: str
    role_title: str
    language: str = "fr"
    questions: list[InterviewQuestion] = Field(min_length=1)
    allow_video: bool = True
    allow_audio_only: bool = True
    max_followups_per_question: int = Field(default=1, ge=0, le=2)
    interview_style: InterviewStyle = Field(default_factory=InterviewStyle)


class CandidateTurnIntent(StrEnum):
    ANSWER_COMPLETE = "answer_complete"
    ANSWER_PARTIAL = "answer_partial"
    CLARIFY_ROLE = "clarify_role"
    CLARIFY_QUESTION = "clarify_question"
    REFORMULATE_REQUEST = "reformulate_request"
    EXAMPLE_REQUEST = "example_request"
    REPEAT_REQUEST = "repeat_request"
    WAIT_REQUEST = "wait_request"
    PASS = "pass"
    TECHNICAL_ISSUE = "technical_issue"
    PREVIOUS_ANSWER_NOT_COMPLETED = "previous_answer_not_completed"
    SILENCE = "silence"


class CandidateTurn(BaseModel):
    question_id: str
    transcript: str
    is_complete: bool = True
    repeat_requested: bool = False
    skip_requested: bool = False
    wait_requested: bool = False
    candidate_intent: CandidateTurnIntent = CandidateTurnIntent.ANSWER_COMPLETE
    is_answer_to_active_question: bool = True
    classifier_reason: str | None = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EventActor(StrEnum):
    AGENT = "agent"
    CANDIDATE = "candidate"
    SYSTEM = "system"


class EventType(StrEnum):
    CANDIDATE_JOINED = "candidate_joined"
    CANDIDATE_MEDIA_READY = "candidate_media_ready"
    AGENT_JOINED = "agent_joined"
    SESSION_STARTED = "session_started"
    AGENT_SPEECH_STARTED = "agent_speech_started"
    AGENT_SPEECH_COMPLETED = "agent_speech_completed"
    AGENT_SPEECH_INTERRUPTED = "agent_speech_interrupted"
    QUESTION_ASKED = "question_asked"
    QUESTION_REPEATED = "question_repeated"
    CANDIDATE_SPEECH_STARTED = "candidate_speech_started"
    CANDIDATE_SPEECH_STOPPED = "candidate_speech_stopped"
    CANDIDATE_TURN_DETECTED = "candidate_turn_detected"
    CANDIDATE_TURN_STARTED = "candidate_turn_started"
    CANDIDATE_TURN_FINALIZED = "candidate_turn_finalized"
    ANSWER_EVALUATED = "answer_evaluated"
    BARGE_IN_DETECTED = "barge_in_detected"
    BARGE_IN_ACCEPTED = "barge_in_accepted"
    BARGE_IN_REJECTED = "barge_in_rejected"
    BACKCHANNEL_DETECTED = "backchannel_detected"
    SILENCE_TIMEOUT_STARTED = "silence_timeout_started"
    WAIT_REQUESTED = "wait_requested"
    SOFT_REPROMPTED = "soft_reprompted"
    FOLLOWUP_ASKED = "followup_asked"
    QUESTION_COMPLETED = "question_completed"
    SESSION_CLOSING = "session_closing"
    SESSION_COMPLETED = "session_completed"
    SESSION_FAILED = "session_failed"
    FREE_CHAT_REQUESTED = "free_chat_requested"


class InterviewEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_id: str = Field(default_factory=lambda: f"evt_{uuid4().hex}")
    type: EventType
    actor: EventActor = EventActor.AGENT
    session_id: str
    candidate_id: str | None = None
    sequence: int = Field(alias="sequence_number")
    idempotency_key: str = Field(default_factory=lambda: str(uuid4()))
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)
    provider_metadata: dict[str, Any] = Field(default_factory=dict)


class AgentSession(BaseModel):
    id: str
    interview_plan_id: str
    candidate_id: str
    status: str
    livekit_room_name: str
    allowed_modalities: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AgentLiveKitJoin(BaseModel):
    room_name: str
    url: str
    token: str
    participant: str
    expires_at: datetime


class AgentConfig(BaseModel):
    session: AgentSession
    livekit_join: AgentLiveKitJoin
    interview_plan: InterviewPlan
    provider: str = "mock"


def create_demo_plan() -> InterviewPlan:
    return InterviewPlan(
        id="plan-demo-product-manager",
        role_title="Product Manager B2B SaaS",
        interview_style=InterviewStyle(
            sector="B2B SaaS",
            seniority="mid to senior",
            work_environment="office or hybrid customer-facing product work",
            role_constraints=[
                "coordinate with product and customer-facing teams",
                "handle roadmap trade-offs under customer pressure",
                "communicate clearly with SMB stakeholders",
            ],
            company_context=(
                "Prelude is screening candidates for a structured first interview "
                "before recruiter review."
            ),
            candidate_tone="professional, concise, and concrete",
        ),
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
