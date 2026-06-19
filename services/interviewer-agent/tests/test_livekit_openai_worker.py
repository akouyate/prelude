from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.adapters.livekit_openai_worker import (
    FIRST_REPLY_INSTRUCTIONS,
    LiveKitAgentEventBridge,
    LiveInterviewOrchestrationController,
    OpenAILiveWorkerConfig,
    PreludeEventEmitter,
    build_live_interviewer_instructions,
    _candidate_turn_from_live_transcript,
    _spoken_question_prompt,
    _soft_prompt_after_initial_silence,
    _supports_realtime_reasoning,
    _wait_for_candidate_ready,
    _wait_for_playout_with_timeout,
)
from app.domain.orchestrator import AnswerClassification, InterviewOrchestrator
from app.domain.models import (
    CandidateTurnIntent,
    EventActor,
    EventType,
    InterviewEvent,
    InterviewPlan,
    InterviewQuestion,
    InterviewStyle,
    QuestionCategory,
    create_demo_plan,
)


class FakeAgentSession:
    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def on(self, event_name: str):
        def register(handler: object) -> object:
            self.handlers[event_name] = handler
            return handler

        return register


@dataclass
class AssistantItem:
    role: str
    text: str

    @property
    def text_content(self) -> str:
        return self.text


class FakeReply:
    def __init__(self) -> None:
        self.playout_waited = False

    async def wait_for_playout(self) -> None:
        self.playout_waited = True


class FakeLiveSession:
    def __init__(self) -> None:
        self.replies: list[dict[str, object]] = []
        self.spoken: list[dict[str, object]] = []
        self.last_reply: FakeReply | None = None

    def generate_reply(self, **kwargs: object) -> FakeReply:
        self.replies.append(kwargs)
        self.last_reply = FakeReply()
        return self.last_reply

    def say(self, text: str, **kwargs: object) -> FakeReply:
        self.spoken.append({"text": text, **kwargs})
        self.last_reply = FakeReply()
        return self.last_reply


class FakeBridge:
    def __init__(
        self,
        *,
        candidate_turn_count: int = 0,
        candidate_is_speaking: bool = False,
        candidate_activity_seen: bool = False,
    ):
        self.candidate_turn_count = candidate_turn_count
        self.candidate_is_speaking = candidate_is_speaking
        self.candidate_activity_seen = candidate_activity_seen
        self.drained = False

    async def drain(self) -> None:
        self.drained = True


async def _append_event(events: list[InterviewEvent], event: InterviewEvent) -> None:
    events.append(event)


@pytest.mark.asyncio
async def test_emitter_serializes_event_delivery_by_sequence() -> None:
    events: list[InterviewEvent] = []
    first_event_started = asyncio.Event()
    release_first_event = asyncio.Event()

    async def emit_event(event: InterviewEvent) -> None:
        if event.sequence == 1:
            first_event_started.set()
            await release_first_event.wait()
        events.append(event)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )

    first = asyncio.create_task(
        emitter.emit(EventType.AGENT_SPEECH_STARTED, {}, actor=EventActor.AGENT)
    )
    await first_event_started.wait()
    second = asyncio.create_task(
        emitter.emit(EventType.AGENT_SPEECH_COMPLETED, {}, actor=EventActor.AGENT)
    )

    await asyncio.sleep(0)
    assert events == []

    release_first_event.set()
    await asyncio.gather(first, second)

    assert [event.sequence for event in events] == [1, 2]


@pytest.mark.asyncio
async def test_livekit_agent_bridge_persists_final_candidate_transcript() -> None:
    events: list[InterviewEvent] = []

    async def emit_event(event: InterviewEvent) -> None:
        events.append(event)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeAgentSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
    )
    bridge.register(session)

    session.handlers["user_input_transcribed"](
        SimpleNamespace(
            transcript="Je suis disponible dans deux semaines.",
            is_final=True,
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    await bridge.drain()

    assert len(events) == 1
    assert events[0].type == EventType.CANDIDATE_TURN_FINALIZED
    assert events[0].actor == EventActor.CANDIDATE
    assert events[0].payload["question_id"] == "unscoped_livekit"
    assert events[0].payload["completion_reason"] == "answered"
    assert events[0].payload["transcript_turn"]["question_id"] == "unscoped_livekit"
    assert events[0].payload["transcript_turn"]["speaker"] == "candidate"
    assert events[0].payload["transcript_turn"]["text"] == "Je suis disponible dans deux semaines."


@pytest.mark.asyncio
async def test_livekit_agent_bridge_persists_assistant_transcript() -> None:
    events: list[InterviewEvent] = []

    async def emit_event(event: InterviewEvent) -> None:
        events.append(event)

    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=emit_event,
    )
    session = FakeAgentSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
    )
    bridge.register(session)

    session.handlers["conversation_item_added"](
        SimpleNamespace(
            item=AssistantItem(
                role="assistant",
                text="Bonjour, pouvez-vous vous presenter brievement ?",
            ),
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    await bridge.drain()

    assert len(events) == 1
    assert events[0].type == EventType.AGENT_SPEECH_COMPLETED
    assert events[0].actor == EventActor.AGENT
    assert events[0].payload["utterance_id"] == "session-test:livekit:unscoped:1"
    assert events[0].payload["utterance_kind"] == "intro"
    assert events[0].payload["transcript_turn"]["speaker"] == "interviewer"
    assert (
        events[0].payload["transcript_turn"]["text"]
        == "Bonjour, pouvez-vous vous presenter brievement ?"
    )


@pytest.mark.asyncio
async def test_livekit_agent_bridge_emits_contract_aligned_session_failed() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeAgentSession()
    bridge = LiveKitAgentEventBridge(emitter=emitter)
    bridge.register(session)

    session.handlers["error"](
        SimpleNamespace(
            error=RuntimeError("provider failure"),
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    await bridge.drain()

    assert len(events) == 1
    assert events[0].type == EventType.SESSION_FAILED
    assert events[0].payload == {
        "code": "livekit_agent_session_error",
        "message": "LiveKit agent session failed: RuntimeError",
        "retryable": True,
    }


@pytest.mark.asyncio
async def test_livekit_agent_bridge_scopes_state_events_to_current_question() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeAgentSession()
    bridge = LiveKitAgentEventBridge(
        emitter=emitter,
        question_id_provider=lambda: "q1",
    )
    bridge.register(session)

    session.handlers["agent_state_changed"](
        SimpleNamespace(
            old_state="listening",
            new_state="speaking",
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    session.handlers["agent_state_changed"](
        SimpleNamespace(
            old_state="speaking",
            new_state="listening",
            created_at=datetime(2026, 6, 18, tzinfo=timezone.utc).timestamp(),
        )
    )
    await bridge.drain()

    assert [event.type for event in events] == [
        EventType.AGENT_SPEECH_STARTED,
        EventType.AGENT_SPEECH_COMPLETED,
    ]
    assert events[0].payload["question_id"] == "q1"
    assert events[0].payload["utterance_id"] == "session-test:livekit:q1:1"
    assert events[0].payload["utterance_kind"] == "question"
    assert events[1].payload["utterance_id"] == events[0].payload["utterance_id"]


@pytest.mark.asyncio
async def test_live_orchestration_controller_completes_three_question_flow() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()
    controller = LiveInterviewOrchestrationController(
        plan=create_demo_plan(),
        emitter=emitter,
        session=session,
    )

    await controller.start()
    await controller.handle_candidate_transcript(
        "Je suis interesse par le poste et le contexte B2B.",
        datetime(2026, 6, 18, tzinfo=timezone.utc),
    )
    await controller.handle_candidate_transcript(
        "J'ai priorise une roadmap avec des contraintes clients fortes.",
        datetime(2026, 6, 18, tzinfo=timezone.utc),
    )
    await controller.handle_candidate_transcript(
        "Je suis disponible dans deux semaines.",
        datetime(2026, 6, 18, tzinfo=timezone.utc),
    )

    event_types = [event.type for event in events]
    assert event_types.count(EventType.QUESTION_ASKED) == 3
    assert event_types.count(EventType.CANDIDATE_TURN_FINALIZED) == 3
    assert event_types.count(EventType.ANSWER_EVALUATED) == 3
    assert event_types.count(EventType.QUESTION_COMPLETED) == 3
    assert event_types.count(EventType.AGENT_SPEECH_STARTED) == 4
    closing_started = [
        event
        for event in events
        if event.type == EventType.AGENT_SPEECH_STARTED
        and event.payload.get("utterance_kind") == "closing"
    ]
    assert len(closing_started) == 1
    assert closing_started[0].payload["utterance_id"].endswith(":live-openai:closing")
    assert events[-2].type == EventType.SESSION_CLOSING
    assert events[-1].type == EventType.SESSION_COMPLETED
    assert events[-2].payload["utterance_id"].endswith(":live-openai:closing")
    assert "suite" in events[-2].payload["closing"]
    assert "premier échange" in events[-2].payload["closing"]
    assert "très bonne journée" in events[-2].payload["closing"]
    assert events[-1].payload["completed_questions"] == 3
    assert events[-1].payload["total_questions"] == 3
    assert events[-1].payload["closing"] == events[-2].payload["closing"]
    assert events[-1].payload["closing_playout_status"] == "completed"
    assert len(session.replies) >= 4
    assert events[-2].payload["closing"] in session.replies[-1]["user_input"]
    assert session.replies[-1]["instructions"].startswith("Say exactly this closing message")
    assert session.replies[-1]["allow_interruptions"] is True


def test_live_transcript_role_clarification_does_not_complete_answer() -> None:
    cases = [
        (
            "Alors on parle de quel poste, excusez-moi ?",
            CandidateTurnIntent.CLARIFY_ROLE,
            "candidate_requested_role_context",
        ),
        (
            "C'est quoi le titre du poste, excusez-moi ?",
            CandidateTurnIntent.CLARIFY_ROLE,
            "candidate_requested_role_context",
        ),
        (
            "Tu peux me donner des exemples ?",
            CandidateTurnIntent.EXAMPLE_REQUEST,
            "candidate_requested_examples",
        ),
        (
            "J'ai pas compris la question, est-ce que vous pouvez reformuler ?",
            CandidateTurnIntent.REFORMULATE_REQUEST,
            "candidate_requested_reformulation",
        ),
        (
            "Je ne vous entends pas, mon micro coupe.",
            CandidateTurnIntent.TECHNICAL_ISSUE,
            "candidate_reported_technical_issue",
        ),
    ]
    for transcript, expected_intent, expected_reason in cases:
        turn = _candidate_turn_from_live_transcript(
            question_id="q1",
            transcript=transcript,
            occurred_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
        )

        assert turn.repeat_requested is True
        assert turn.is_complete is False
        assert turn.candidate_intent == expected_intent
        assert turn.is_answer_to_active_question is False
        assert turn.classifier_reason == expected_reason
        assert (
            InterviewOrchestrator.classify_candidate_turn(turn)
            == AnswerClassification.REPEAT_REQUESTED
        )


def test_live_transcript_classifies_wait_partial_and_complete_answers() -> None:
    wait_turn = _candidate_turn_from_live_transcript(
        question_id="q1",
        transcript="Attendez une seconde s'il vous plait.",
        occurred_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
    )
    partial_turn = _candidate_turn_from_live_transcript(
        question_id="q1",
        transcript="Oui.",
        occurred_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
    )
    answer_turn = _candidate_turn_from_live_transcript(
        question_id="q1",
        transcript="J'ai cinq ans d'experience en product management B2B.",
        occurred_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
    )

    assert wait_turn.wait_requested is True
    assert wait_turn.candidate_intent == CandidateTurnIntent.WAIT_REQUEST
    assert (
        InterviewOrchestrator.classify_candidate_turn(wait_turn)
        == AnswerClassification.WAIT_REQUESTED
    )

    assert partial_turn.candidate_intent == CandidateTurnIntent.ANSWER_PARTIAL
    assert partial_turn.is_answer_to_active_question is True
    assert InterviewOrchestrator.classify_candidate_turn(partial_turn) == AnswerClassification.VAGUE

    assert answer_turn.candidate_intent == CandidateTurnIntent.ANSWER_COMPLETE
    assert answer_turn.is_complete is True
    assert (
        InterviewOrchestrator.classify_candidate_turn(answer_turn)
        == AnswerClassification.COMPLETE
    )


def test_live_transcript_does_not_confuse_answer_examples_with_example_request() -> None:
    for transcript in [
        "Par exemple, j'ai priorise une roadmap apres un incident client.",
        "J'ai travaille sur des microservices avec l'equipe technique.",
        "J'ai du passer d'un projet a un autre avec tres peu de contexte.",
    ]:
        turn = _candidate_turn_from_live_transcript(
            question_id="q1",
            transcript=transcript,
            occurred_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
        )

        assert turn.candidate_intent == CandidateTurnIntent.ANSWER_COMPLETE
        assert turn.is_complete is True
        assert turn.repeat_requested is False
        assert (
            InterviewOrchestrator.classify_candidate_turn(turn)
            == AnswerClassification.COMPLETE
        )


@pytest.mark.asyncio
async def test_live_orchestration_controller_repeats_role_context_without_completing_question() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()
    controller = LiveInterviewOrchestrationController(
        plan=create_demo_plan(),
        emitter=emitter,
        session=session,
    )

    await controller.start()
    await controller.handle_candidate_transcript(
        "Alors on parle de quel poste, excusez-moi ?",
        datetime(2026, 6, 18, tzinfo=timezone.utc),
    )

    event_types = [event.type for event in events]
    assert event_types.count(EventType.ANSWER_EVALUATED) == 1
    assert event_types.count(EventType.QUESTION_REPEATED) == 1
    assert EventType.QUESTION_COMPLETED not in event_types
    finalized = next(event for event in events if event.type == EventType.CANDIDATE_TURN_FINALIZED)
    assert finalized.payload["candidate_intent"] == "clarify_role"
    assert finalized.payload["is_answer_to_active_question"] is False
    assert finalized.payload["classifier_reason"] == "candidate_requested_role_context"
    evaluated = next(event for event in events if event.type == EventType.ANSWER_EVALUATED)
    assert "candidate_intent:clarify_role" in evaluated.payload["reason_codes"]
    repeated = next(event for event in events if event.type == EventType.QUESTION_REPEATED)
    assert "Product Manager B2B SaaS" in repeated.payload["prompt"]
    assert "Do not move to the next question" in session.replies[-1]["instructions"]


@pytest.mark.asyncio
async def test_live_orchestration_controller_gives_examples_without_completing_question() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()
    controller = LiveInterviewOrchestrationController(
        plan=create_demo_plan(),
        emitter=emitter,
        session=session,
    )

    await controller.start()
    await controller.handle_candidate_transcript(
        "Tu peux me donner des exemples ?",
        datetime(2026, 6, 18, tzinfo=timezone.utc),
    )

    event_types = [event.type for event in events]
    assert event_types.count(EventType.QUESTION_REPEATED) == 1
    assert EventType.QUESTION_COMPLETED not in event_types
    repeated = next(event for event in events if event.type == EventType.QUESTION_REPEATED)
    assert repeated.payload["candidate_intent"] == "example_request"
    assert repeated.payload["reason"] == "candidate_requested_examples"
    assert "neutral examples" in session.replies[-1]["instructions"]
    assert "Do not move to the next question" in session.replies[-1]["instructions"]


@pytest.mark.asyncio
async def test_wait_for_playout_with_timeout_never_blocks_session_completion() -> None:
    async def never_finishes() -> None:
        await asyncio.sleep(1)

    status = await _wait_for_playout_with_timeout(
        never_finishes,
        timeout_seconds=0,
    )

    assert status == "timeout"


@pytest.mark.asyncio
async def test_live_orchestration_controller_routes_initial_silence_to_soft_reprompt() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()
    controller = LiveInterviewOrchestrationController(
        plan=create_demo_plan(),
        emitter=emitter,
        session=session,
    )
    await controller.start()

    await _soft_prompt_after_initial_silence(
        bridge=FakeBridge(),
        threshold_seconds=0,
        on_initial_silence=controller.handle_initial_silence,
        emitter=emitter,
        question_id="q1",
    )

    event_types = [event.type for event in events]
    assert EventType.SILENCE_TIMEOUT_STARTED in event_types
    assert EventType.ANSWER_EVALUATED in event_types
    assert EventType.SOFT_REPROMPTED in event_types
    evaluated = next(event for event in events if event.type == EventType.ANSWER_EVALUATED)
    assert evaluated.payload["classification"] == "silent"
    assert evaluated.payload["policy_action"] == "soft_reprompt"


def test_live_worker_config_reads_max_duration_from_env() -> None:
    config = OpenAILiveWorkerConfig.from_env(
        {
            "OPENAI_REALTIME_MODEL": "gpt-realtime",
            "OPENAI_REALTIME_VOICE": "marin",
            "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
            "OPENAI_REALTIME_REASONING_EFFORT": "low",
            "LIVE_WORKER_MAX_DURATION_SECONDS": "2.5",
            "LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS": "8",
        }
    )

    assert config.max_duration_seconds == 2.5
    assert config.candidate_ready_timeout_seconds == 120.0
    assert config.soft_prompt_after_seconds == 8


@pytest.mark.asyncio
async def test_soft_prompt_after_initial_silence_emits_event_and_reprompts() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()
    bridge = FakeBridge()

    await _soft_prompt_after_initial_silence(
        session=session,
        emitter=emitter,
        bridge=bridge,
        question_id="q1",
        threshold_seconds=0,
    )

    assert bridge.drained
    assert events[0].type == EventType.SILENCE_TIMEOUT_STARTED
    assert events[0].actor == EventActor.SYSTEM
    assert events[0].payload == {
        "question_id": "q1",
        "tier": "soft_prompt",
        "threshold_ms": 0,
    }
    assert session.replies
    assert session.replies[0]["allow_interruptions"] is True
    assert session.last_reply is not None
    assert session.last_reply.playout_waited


@pytest.mark.asyncio
async def test_soft_prompt_after_initial_silence_skips_when_candidate_answered() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()

    await _soft_prompt_after_initial_silence(
        session=session,
        emitter=emitter,
        bridge=FakeBridge(candidate_turn_count=1),
        question_id="q1",
        threshold_seconds=0,
    )

    assert events == []
    assert session.replies == []


@pytest.mark.asyncio
async def test_soft_prompt_after_initial_silence_skips_when_candidate_had_activity() -> None:
    events: list[InterviewEvent] = []
    emitter = PreludeEventEmitter(
        session_id="session-test",
        candidate_id="candidate-test",
        provider_metadata={"provider": "openai_realtime"},
        emit_event=lambda event: _append_event(events, event),
    )
    session = FakeLiveSession()

    await _soft_prompt_after_initial_silence(
        session=session,
        emitter=emitter,
        bridge=FakeBridge(candidate_activity_seen=True),
        question_id="q1",
        threshold_seconds=0,
    )

    assert events == []
    assert session.replies == []


@pytest.mark.asyncio
async def test_wait_for_candidate_ready_polls_until_joined_and_media_ready() -> None:
    seen_events: list[EventType] = []
    available_events: set[EventType] = set()

    async def has_event(_session_id: str, event_type: EventType) -> bool:
        seen_events.append(event_type)
        if event_type == EventType.CANDIDATE_JOINED:
            available_events.add(EventType.CANDIDATE_JOINED)
        if (
            event_type == EventType.CANDIDATE_MEDIA_READY
            and EventType.CANDIDATE_JOINED in available_events
        ):
            available_events.add(EventType.CANDIDATE_MEDIA_READY)
        return event_type in available_events

    await _wait_for_candidate_ready(
        session_id="session-test",
        has_event=has_event,
        timeout_seconds=1,
        poll_interval_seconds=0,
    )

    assert EventType.CANDIDATE_JOINED in seen_events
    assert EventType.CANDIDATE_MEDIA_READY in seen_events


def test_live_interviewer_instructions_keep_first_screening_scope() -> None:
    instructions = build_live_interviewer_instructions(create_demo_plan())

    assert "first screening interview" in instructions
    assert "Ask one question at a time" in instructions
    assert "Never score or comment on face, accent, tone, emotion" in instructions
    assert "Product Manager B2B SaaS" in instructions


def test_live_interviewer_instructions_onboard_without_product_narration() -> None:
    instructions = build_live_interviewer_instructions(create_demo_plan())

    assert "Candidate onboarding:" in instructions
    assert "one brief orientation sentence" in instructions
    assert "short first-screening conversation" in instructions
    assert "consistent interview" in instructions
    assert "Do not turn the introduction into product narration" in instructions
    assert "Do not repeat the onboarding if the candidate interrupts" in instructions


def test_live_interviewer_instructions_adapt_to_operational_roles() -> None:
    plan = InterviewPlan(
        id="plan-restaurant-server",
        role_title="Serveur en restauration",
        interview_style=InterviewStyle(
            sector="restauration",
            seniority="entry level",
            work_environment="frontline shift work",
            role_constraints=[
                "late shifts",
                "standing work",
                "direct customer interaction",
            ],
            candidate_tone="simple, direct, and reassuring",
        ),
        questions=[
            InterviewQuestion(
                id="q1",
                prompt="Pouvez-vous me parler de votre experience en service ?",
                category=QuestionCategory.EXPERIENCE,
            ),
            InterviewQuestion(
                id="q2",
                prompt="Quelles sont vos disponibilites pour les prochains mois ?",
                category=QuestionCategory.LOGISTICS,
            ),
        ],
    )

    instructions = build_live_interviewer_instructions(plan)

    assert "Structured interview style:" in instructions
    assert "- Sector: restauration" in instructions
    assert "- Work environment: frontline shift work" in instructions
    assert "late shifts; standing work; direct customer interaction" in instructions
    assert "- Candidate tone: simple, direct, and reassuring" in instructions
    assert "Use the structured interview style first" in instructions
    assert (
        "frontline, operational, shift-based, hospitality, logistics, restaurant"
        in instructions
    )
    assert "plain and concrete language" in instructions
    assert "experience, availability" in instructions
    assert (
        "mobility, customer interaction, work rhythm, safety, and team fit"
        in instructions
    )
    assert "Never force a corporate interview style" in instructions


def test_live_interviewer_instructions_have_style_fallback() -> None:
    plan = InterviewPlan(
        id="plan-minimal",
        role_title="Support Agent",
        questions=[
            InterviewQuestion(
                id="q1",
                prompt="Tell me about your support experience.",
            )
        ],
    )

    instructions = build_live_interviewer_instructions(plan)

    assert (
        "- No structured style context provided. Infer from the role and questions."
        in instructions
    )


def test_live_interviewer_instructions_use_listening_without_fake_empathy() -> None:
    instructions = build_live_interviewer_instructions(create_demo_plan())

    assert "Candidate comfort:" in instructions
    assert "fixed canned comfort phrases" in instructions
    assert "Do not pretend to feel emotions" in instructions
    assert 'Avoid generic reassurance such as "don\'t worry" or "rassurez-vous"' in instructions
    assert "Listening and pacing:" in instructions
    assert "Do not interrupt" in instructions
    assert "Avoid paraphrasing every answer" in instructions
    assert "If an answer is complete, move to the next planned question" in instructions
    assert "ask at most one concise follow-up" in instructions


def test_live_interviewer_instructions_avoid_restarting_greeting() -> None:
    instructions = build_live_interviewer_instructions(create_demo_plan())

    assert "do not restart the greeting or onboarding" in FIRST_REPLY_INSTRUCTIONS
    assert "resume the current planned question" in FIRST_REPLY_INSTRUCTIONS
    assert "Greet once at the beginning only" in instructions
    assert "do not add another greeting" in instructions


def test_live_interviewer_instructions_strip_prompt_initial_greeting_for_speech() -> None:
    instructions = build_live_interviewer_instructions(create_demo_plan())

    assert _spoken_question_prompt(
        "Bonjour, pouvez-vous vous presenter brievement ?"
    ) == "pouvez-vous vous presenter brievement ?"
    assert _spoken_question_prompt("Hello! Tell me about yourself.") == (
        "Tell me about yourself."
    )
    assert "1. [motivation] pouvez-vous vous presenter brievement" in instructions
    assert "1. [motivation] Bonjour, pouvez-vous" not in instructions


def test_realtime_reasoning_is_only_enabled_for_supported_models() -> None:
    assert _supports_realtime_reasoning("gpt-realtime-2")
    assert not _supports_realtime_reasoning("gpt-realtime")
