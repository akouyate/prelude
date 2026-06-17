from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.models import CandidateTurn, EventType


class InterruptionClassification(StrEnum):
    INTERRUPTION = "interruption"
    BACKCHANNEL = "backchannel"
    NOISE = "noise"
    UNKNOWN = "unknown"


class TurnTakingAction(StrEnum):
    KEEP_LISTENING = "keep_listening"
    FINALIZE_TURN = "finalize_turn"
    ALLOW_AGENT_SPEECH = "allow_agent_speech"
    BLOCK_AGENT_SPEECH = "block_agent_speech"
    ACCEPT_BARGE_IN = "accept_barge_in"
    REJECT_BARGE_IN = "reject_barge_in"
    SOFT_PROMPT = "soft_prompt"
    REPEAT_QUESTION = "repeat_question"
    WAIT = "wait"
    COMPLETE_QUESTION = "complete_question"
    SKIP_QUESTION = "skip_question"


@dataclass(frozen=True)
class TurnTakingConfig:
    vad_end_silence_ms: int = 900
    barge_in_min_speech_ms: int = 300
    soft_prompt_after_ms: int = 10_000
    wait_request_timeout_ms: int = 30_000


@dataclass(frozen=True)
class TurnTakingDecision:
    action: TurnTakingAction
    events: tuple[EventType, ...] = ()
    allow_agent_speech: bool = True
    cancel_agent_audio: bool = False
    reason: str | None = None


@dataclass
class TurnTakingPolicy:
    config: TurnTakingConfig = field(default_factory=TurnTakingConfig)
    agent_speaking: bool = False
    candidate_speaking: bool = False
    active_question_id: str | None = None
    wait_requested_by_question: dict[str, bool] = field(default_factory=dict)
    soft_prompted_questions: set[str] = field(default_factory=set)
    last_candidate_speech_started_at_ms: int | None = None
    last_candidate_speech_stopped_at_ms: int | None = None

    def agent_speech_started(
        self,
        *,
        question_id: str | None,
        utterance_kind: str,
        at_ms: int | None = None,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id
        if self.candidate_speaking:
            return TurnTakingDecision(
                action=TurnTakingAction.BLOCK_AGENT_SPEECH,
                allow_agent_speech=False,
                reason="candidate_speaking",
            )

        self.agent_speaking = True
        return TurnTakingDecision(
            action=TurnTakingAction.ALLOW_AGENT_SPEECH,
            events=(EventType.AGENT_SPEECH_STARTED,),
            reason=utterance_kind,
        )

    def agent_speech_completed(
        self,
        *,
        question_id: str | None,
        at_ms: int | None = None,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id or self.active_question_id
        self.agent_speaking = False
        return TurnTakingDecision(
            action=TurnTakingAction.KEEP_LISTENING,
            events=(EventType.AGENT_SPEECH_COMPLETED,),
        )

    def candidate_speech_started(
        self,
        *,
        question_id: str | None,
        at_ms: int | None = None,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id or self.active_question_id
        self.candidate_speaking = True
        self.last_candidate_speech_started_at_ms = at_ms
        events = [EventType.CANDIDATE_SPEECH_STARTED]
        if self.agent_speaking:
            events.append(EventType.BARGE_IN_DETECTED)

        return TurnTakingDecision(
            action=TurnTakingAction.KEEP_LISTENING,
            events=tuple(events),
        )

    def candidate_speech_stopped(
        self,
        *,
        question_id: str | None,
        at_ms: int | None = None,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id or self.active_question_id
        self.candidate_speaking = False
        self.last_candidate_speech_stopped_at_ms = at_ms
        return TurnTakingDecision(
            action=TurnTakingAction.KEEP_LISTENING,
            events=(EventType.CANDIDATE_SPEECH_STOPPED,),
        )

    def candidate_turn_detected(
        self,
        *,
        question_id: str,
        stable_silence_ms: int,
        semantic_complete: bool,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id
        if semantic_complete or stable_silence_ms >= self.config.vad_end_silence_ms:
            return TurnTakingDecision(
                action=TurnTakingAction.FINALIZE_TURN,
                events=(EventType.CANDIDATE_TURN_DETECTED,),
            )

        return TurnTakingDecision(
            action=TurnTakingAction.KEEP_LISTENING,
            reason="candidate_may_continue",
        )

    def classify_interruption(
        self,
        *,
        question_id: str | None,
        candidate_audio_ms: int,
        classification: InterruptionClassification,
        at_ms: int | None = None,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id or self.active_question_id
        if not self.agent_speaking:
            return TurnTakingDecision(
                action=TurnTakingAction.KEEP_LISTENING,
                reason="agent_not_speaking",
            )

        is_false_barge_in = classification in {
            InterruptionClassification.BACKCHANNEL,
            InterruptionClassification.NOISE,
        }
        is_too_short = candidate_audio_ms < self.config.barge_in_min_speech_ms
        if is_false_barge_in or is_too_short:
            events = [EventType.BARGE_IN_REJECTED]
            if classification == InterruptionClassification.BACKCHANNEL:
                events.insert(0, EventType.BACKCHANNEL_DETECTED)
            return TurnTakingDecision(
                action=TurnTakingAction.REJECT_BARGE_IN,
                events=tuple(events),
                cancel_agent_audio=False,
                reason=classification.value if is_false_barge_in else "speech_too_short",
            )

        self.agent_speaking = False
        return TurnTakingDecision(
            action=TurnTakingAction.ACCEPT_BARGE_IN,
            events=(EventType.BARGE_IN_ACCEPTED, EventType.AGENT_SPEECH_INTERRUPTED),
            cancel_agent_audio=True,
        )

    def silence_elapsed(self, *, question_id: str, elapsed_ms: int) -> TurnTakingDecision:
        self.active_question_id = question_id
        threshold = (
            self.config.wait_request_timeout_ms
            if self.wait_requested_by_question.get(question_id)
            else self.config.soft_prompt_after_ms
        )
        if elapsed_ms < threshold or question_id in self.soft_prompted_questions:
            return TurnTakingDecision(action=TurnTakingAction.WAIT)

        self.soft_prompted_questions.add(question_id)
        return TurnTakingDecision(
            action=TurnTakingAction.SOFT_PROMPT,
            events=(EventType.SILENCE_TIMEOUT_STARTED,),
        )

    def candidate_wait_requested(
        self,
        *,
        question_id: str,
        at_ms: int | None = None,
    ) -> TurnTakingDecision:
        self.active_question_id = question_id
        self.wait_requested_by_question[question_id] = True
        return TurnTakingDecision(
            action=TurnTakingAction.WAIT,
            events=(EventType.WAIT_REQUESTED,),
        )

    def evaluate_candidate_turn(self, turn: CandidateTurn) -> TurnTakingDecision:
        self.active_question_id = turn.question_id
        if turn.repeat_requested:
            return TurnTakingDecision(action=TurnTakingAction.REPEAT_QUESTION)
        if turn.wait_requested:
            return self.candidate_wait_requested(question_id=turn.question_id)
        if turn.skip_requested:
            return TurnTakingDecision(action=TurnTakingAction.SKIP_QUESTION)
        if not turn.is_complete:
            return self.silence_elapsed(
                question_id=turn.question_id,
                elapsed_ms=self.config.soft_prompt_after_ms,
            )

        return TurnTakingDecision(action=TurnTakingAction.COMPLETE_QUESTION)
