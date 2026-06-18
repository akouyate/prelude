from app.domain.models import CandidateTurn, EventType
from app.domain.turn_taking import (
    InterruptionClassification,
    TurnTakingAction,
    TurnTakingConfig,
    TurnTakingPolicy,
)


def test_policy_finalizes_normal_turn_after_semantic_completion() -> None:
    policy = TurnTakingPolicy()

    policy.candidate_speech_started(question_id="q1", at_ms=1_000)
    policy.candidate_speech_stopped(question_id="q1", at_ms=4_000)
    decision = policy.candidate_turn_detected(
        question_id="q1",
        stable_silence_ms=250,
        semantic_complete=True,
    )

    assert decision.action == TurnTakingAction.FINALIZE_TURN
    assert decision.events == (EventType.CANDIDATE_TURN_DETECTED,)


def test_policy_keeps_listening_for_mid_question_pause() -> None:
    policy = TurnTakingPolicy(config=TurnTakingConfig(vad_end_silence_ms=900))

    policy.candidate_speech_started(question_id="q1", at_ms=1_000)
    policy.candidate_speech_stopped(question_id="q1", at_ms=2_000)
    decision = policy.candidate_turn_detected(
        question_id="q1",
        stable_silence_ms=400,
        semantic_complete=False,
    )

    assert decision.action == TurnTakingAction.KEEP_LISTENING
    assert policy.candidate_speaking is False


def test_policy_blocks_agent_speech_while_candidate_is_speaking() -> None:
    policy = TurnTakingPolicy()

    policy.candidate_speech_started(question_id="q1", at_ms=1_000)
    decision = policy.agent_speech_started(
        question_id="q1",
        utterance_kind="question",
        at_ms=1_050,
    )

    assert decision.action == TurnTakingAction.BLOCK_AGENT_SPEECH
    assert decision.allow_agent_speech is False


def test_policy_accepts_true_barge_in_and_cancels_agent_audio() -> None:
    policy = TurnTakingPolicy(config=TurnTakingConfig(barge_in_min_speech_ms=300))

    policy.agent_speech_started(question_id="q1", utterance_kind="question", at_ms=1_000)
    detected = policy.candidate_speech_started(question_id="q1", at_ms=1_120)
    accepted = policy.classify_interruption(
        question_id="q1",
        candidate_audio_ms=340,
        classification=InterruptionClassification.INTERRUPTION,
        at_ms=1_460,
    )

    assert detected.events == (EventType.CANDIDATE_SPEECH_STARTED, EventType.BARGE_IN_DETECTED)
    assert accepted.action == TurnTakingAction.ACCEPT_BARGE_IN
    assert accepted.cancel_agent_audio is True
    assert EventType.AGENT_SPEECH_INTERRUPTED in accepted.events
    assert policy.agent_speaking is False


def test_policy_rejects_backchannel_false_barge_in() -> None:
    policy = TurnTakingPolicy(config=TurnTakingConfig(barge_in_min_speech_ms=300))

    policy.agent_speech_started(question_id="q1", utterance_kind="question", at_ms=1_000)
    policy.candidate_speech_started(question_id="q1", at_ms=1_120)
    rejected = policy.classify_interruption(
        question_id="q1",
        candidate_audio_ms=500,
        classification=InterruptionClassification.BACKCHANNEL,
        at_ms=1_620,
    )

    assert rejected.action == TurnTakingAction.REJECT_BARGE_IN
    assert rejected.cancel_agent_audio is False
    assert rejected.events == (
        EventType.BACKCHANNEL_DETECTED,
        EventType.BARGE_IN_REJECTED,
    )
    assert policy.agent_speaking is True


def test_policy_extends_patience_after_wait_request() -> None:
    policy = TurnTakingPolicy(
        config=TurnTakingConfig(
            soft_prompt_after_ms=10_000,
            wait_request_timeout_ms=30_000,
        )
    )

    wait = policy.candidate_wait_requested(question_id="q1", at_ms=2_000)
    early = policy.silence_elapsed(question_id="q1", elapsed_ms=12_000)
    late = policy.silence_elapsed(question_id="q1", elapsed_ms=31_000)

    assert wait.events == (EventType.WAIT_REQUESTED,)
    assert early.action == TurnTakingAction.WAIT
    assert late.action == TurnTakingAction.SOFT_PROMPT
    assert late.events == (EventType.SILENCE_TIMEOUT_STARTED,)


def test_policy_soft_prompts_once_for_silence() -> None:
    policy = TurnTakingPolicy(config=TurnTakingConfig(soft_prompt_after_ms=10_000))

    first = policy.silence_elapsed(question_id="q1", elapsed_ms=12_000)
    second = policy.silence_elapsed(question_id="q1", elapsed_ms=15_000)

    assert first.action == TurnTakingAction.SOFT_PROMPT
    assert first.events == (EventType.SILENCE_TIMEOUT_STARTED,)
    assert second.action == TurnTakingAction.WAIT


def test_policy_repeats_or_reprompts_from_candidate_turn_flags() -> None:
    policy = TurnTakingPolicy()

    repeat = policy.evaluate_candidate_turn(
        CandidateTurn(question_id="q1", transcript="Pouvez-vous repeter ?", repeat_requested=True)
    )
    incomplete = policy.evaluate_candidate_turn(
        CandidateTurn(question_id="q1", transcript="", is_complete=False)
    )

    assert repeat.action == TurnTakingAction.REPEAT_QUESTION
    assert incomplete.action == TurnTakingAction.SOFT_PROMPT
