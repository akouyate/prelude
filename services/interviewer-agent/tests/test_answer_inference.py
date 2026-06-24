from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.adapters.answer_inference import (
    DEFAULT_OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS,
    FallbackAnswerInferenceProvider,
    OpenAIAnswerInferenceConfig,
    OpenAIAnswerInferenceProvider,
)
from app.domain.models import (
    CandidateTurn,
    CandidateTurnIntent,
    InterviewQuestion,
    QuestionCategory,
    create_demo_plan,
)
from app.domain.orchestrator import AnswerClassification


class FakeResponsesClient:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return SimpleNamespace(output_text=self.output_text)


class FailingProvider:
    async def assess_answer(self, **_kwargs: object):
        raise RuntimeError("provider failed")


class SlowProvider:
    def __init__(self, delay: float) -> None:
        self.delay = delay

    async def assess_answer(self, **_kwargs: object):
        await asyncio.sleep(self.delay)
        raise AssertionError("slow primary should have been cancelled by the budget")


def test_default_answer_inference_latency_budget_is_tight() -> None:
    # S4: keep the LLM evaluator on the path but bound it tightly so the next
    # utterance is never stalled by a slow evaluation (the 2-4.5s dead air seen
    # in the live log). The default budget is ~1.5s; beyond it we fall back to
    # the fast local heuristic, which still probes weak answers.
    assert DEFAULT_OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS <= 1.5
    assert OpenAIAnswerInferenceConfig.from_env({}).timeout_seconds <= 1.5


@pytest.mark.asyncio
async def test_fallback_answer_inference_uses_heuristic_when_primary_exceeds_budget() -> None:
    plan = create_demo_plan()
    provider = FallbackAnswerInferenceProvider(
        primary=SlowProvider(delay=5.0),
        timeout_seconds=0.1,
    )

    assessment = await provider.assess_answer(
        plan=plan,
        question=plan.questions[0],
        turn=CandidateTurn(
            question_id="q1",
            transcript="Oui.",
            is_complete=False,
            candidate_intent=CandidateTurnIntent.ANSWER_PARTIAL,
            classifier_reason="answer_too_short_or_generic",
        ),
    )

    assert assessment.classification == AnswerClassification.VAGUE
    assert any(code.startswith("llm_fallback:") for code in assessment.reason_codes)


@pytest.mark.asyncio
async def test_openai_answer_inference_parses_llm_matrix_without_network() -> None:
    client = FakeResponsesClient(
        """
        {
          "classification": "vague",
          "reason_codes": ["answer_off_topic"],
          "confidence": 0.82,
          "scores": {
            "clarity": 3,
            "relevance": 1,
            "concreteness": 1,
            "coherence": 2,
            "role_signal": 0
          },
          "challenge_needed": true,
          "challenge_reason": "answer_off_topic",
          "challenge_prompt": "Pouvez-vous répondre directement à la question ?"
        }
        """
    )
    plan = create_demo_plan()
    provider = OpenAIAnswerInferenceProvider(
        config=OpenAIAnswerInferenceConfig(model="gpt-test", timeout_seconds=1),
        client=client,
    )

    assessment = await provider.assess_answer(
        plan=plan,
        question=plan.questions[0],
        turn=CandidateTurn(
            question_id="q1",
            transcript="Je préfère parler de football.",
        ),
    )

    assert assessment.classification == AnswerClassification.VAGUE
    assert assessment.reason_codes == ["answer_off_topic"]
    assert assessment.confidence == 0.82
    assert assessment.evaluation_matrix is not None
    assert assessment.evaluation_matrix.evaluator_mode == "llm_assisted"
    assert assessment.evaluation_matrix.challenge_needed is True
    assert client.calls[0]["model"] == "gpt-test"
    assert client.calls[0]["temperature"] == 0


@pytest.mark.asyncio
async def test_openai_answer_inference_derives_label_from_matrix_not_freeform() -> None:
    # The realtime evaluator sometimes returns a free-form label that contradicts
    # its own matrix: here it says "vague" while scoring the answer 13/15 with no
    # challenge. Trusting that label made the interviewer probe a strong answer
    # (the "j'ai deja repondu" harassment seen in the live log). The classification
    # must be DERIVED from the matrix, so a high-scoring, no-challenge answer is
    # COMPLETE and the orchestrator moves on instead of forcing a follow-up.
    client = FakeResponsesClient(
        """
        {
          "classification": "vague",
          "reason_codes": ["wants_more_depth"],
          "confidence": 0.7,
          "scores": {
            "clarity": 3,
            "relevance": 3,
            "concreteness": 2,
            "coherence": 3,
            "role_signal": 2
          },
          "challenge_needed": false,
          "challenge_reason": null,
          "challenge_prompt": null
        }
        """
    )
    plan = create_demo_plan()
    provider = OpenAIAnswerInferenceProvider(
        config=OpenAIAnswerInferenceConfig(model="gpt-test", timeout_seconds=1),
        client=client,
    )

    assessment = await provider.assess_answer(
        plan=plan,
        question=plan.questions[0],
        turn=CandidateTurn(
            question_id="q1",
            transcript=(
                "Ce qui me plait c'est avant tout le fait de manager une equipe et "
                "de la faire grandir sur la duree, avec des resultats concrets."
            ),
        ),
    )

    assert assessment.classification == AnswerClassification.COMPLETE
    assert assessment.evaluation_matrix is not None
    assert assessment.evaluation_matrix.overall_score == 13
    assert assessment.evaluation_matrix.challenge_needed is False


@pytest.mark.asyncio
async def test_answer_inference_input_includes_recruiter_expected_signal() -> None:
    client = FakeResponsesClient(
        """
        {
          "classification": "complete",
          "reason_codes": [],
          "confidence": 0.9,
          "scores": {"clarity": 3, "relevance": 3, "concreteness": 3, "coherence": 3, "role_signal": 3},
          "challenge_needed": false,
          "challenge_reason": null,
          "challenge_prompt": null
        }
        """
    )
    plan = create_demo_plan()
    question = InterviewQuestion(
        id="q1",
        prompt="Describe a hard tradeoff you owned end to end.",
        category=QuestionCategory.EXPERIENCE,
        expected_signal="ownership and decision-making under constraints",
    )
    provider = OpenAIAnswerInferenceProvider(
        config=OpenAIAnswerInferenceConfig(model="gpt-test", timeout_seconds=1),
        client=client,
    )

    await provider.assess_answer(
        plan=plan,
        question=question,
        turn=CandidateTurn(
            question_id="q1",
            transcript=(
                "J'ai arbitre une roadmap en coupant une feature pour tenir le "
                "delai, et je l'ai explique aux parties prenantes."
            ),
        ),
    )

    assert client.calls, "expected the LLM evaluator to run for a complete answer"
    payload = json.loads(client.calls[0]["input"])
    assert (
        payload["active_question"]["expected_signal"]
        == "ownership and decision-making under constraints"
    )


@pytest.mark.asyncio
async def test_fallback_answer_inference_uses_heuristic_when_primary_fails() -> None:
    plan = create_demo_plan()
    provider = FallbackAnswerInferenceProvider(
        primary=FailingProvider(),
        timeout_seconds=0.1,
    )

    assessment = await provider.assess_answer(
        plan=plan,
        question=plan.questions[0],
        turn=CandidateTurn(
            question_id="q1",
            transcript="Oui.",
            is_complete=False,
            candidate_intent=CandidateTurnIntent.ANSWER_PARTIAL,
            classifier_reason="answer_too_short_or_generic",
        ),
    )

    assert assessment.classification == AnswerClassification.VAGUE
    assert "answer_too_short_or_generic" in assessment.reason_codes
    assert "llm_fallback:RuntimeError" in assessment.reason_codes


@pytest.mark.asyncio
async def test_openai_answer_inference_skips_network_for_non_answer_turns() -> None:
    client = FakeResponsesClient("{}")
    plan = create_demo_plan()
    provider = OpenAIAnswerInferenceProvider(
        config=OpenAIAnswerInferenceConfig(model="gpt-test", timeout_seconds=1),
        client=client,
    )

    assessment = await provider.assess_answer(
        plan=plan,
        question=plan.questions[0],
        turn=CandidateTurn(
            question_id="q1",
            transcript="Oui.",
            is_complete=False,
            candidate_intent=CandidateTurnIntent.ANSWER_PARTIAL,
            classifier_reason="answer_too_short_or_generic",
        ),
    )

    assert assessment.classification == AnswerClassification.VAGUE
    assert client.calls == []
