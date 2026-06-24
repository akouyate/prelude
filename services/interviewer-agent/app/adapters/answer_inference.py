from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.orchestrator import (
    AnswerClassification,
    CandidateAnswerAssessment,
    EvaluationDimension,
    EvaluationMatrix,
    EvaluationMatrixDimension,
    InterviewOrchestrator,
)


DEFAULT_OPENAI_ANSWER_INFERENCE_MODEL = "gpt-4.1-mini"
DEFAULT_OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS = 4.0


class HeuristicAnswerInferenceProvider:
    """Fast local strategy for live answer scoring."""

    async def assess_answer(
        self,
        *,
        plan: InterviewPlan,
        question: InterviewQuestion,
        turn: CandidateTurn,
    ) -> CandidateAnswerAssessment:
        return InterviewOrchestrator.assess_candidate_turn(
            plan=plan,
            question=question,
            turn=turn,
        )


class OpenAIResponsesClient(Protocol):
    async def create(
        self,
        *,
        model: str,
        instructions: str,
        input: str,
        temperature: float,
        max_output_tokens: int,
        timeout: float,
    ) -> object:
        """Subset of OpenAI Responses API used by the answer inference adapter."""


@dataclass(frozen=True)
class OpenAIAnswerInferenceConfig:
    model: str = DEFAULT_OPENAI_ANSWER_INFERENCE_MODEL
    timeout_seconds: float = DEFAULT_OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
    ) -> OpenAIAnswerInferenceConfig:
        source = env if env is not None else os.environ
        timeout = source.get("OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS")
        return cls(
            model=source.get(
                "OPENAI_ANSWER_INFERENCE_MODEL",
                DEFAULT_OPENAI_ANSWER_INFERENCE_MODEL,
            ),
            timeout_seconds=float(timeout)
            if timeout
            else DEFAULT_OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS,
        )


class OpenAIAnswerInferenceProvider:
    """LLM-backed answer evaluator with a strict schema and bounded latency."""

    def __init__(
        self,
        *,
        config: OpenAIAnswerInferenceConfig,
        client: OpenAIResponsesClient | None = None,
    ) -> None:
        self._config = config
        self._client = client or _openai_responses_client()

    async def assess_answer(
        self,
        *,
        plan: InterviewPlan,
        question: InterviewQuestion,
        turn: CandidateTurn,
    ) -> CandidateAnswerAssessment:
        deterministic = InterviewOrchestrator.classify_candidate_turn(turn)
        if deterministic != AnswerClassification.COMPLETE:
            return InterviewOrchestrator.assess_candidate_turn(
                plan=plan,
                question=question,
                turn=turn,
            )

        response = await self._client.create(
            model=self._config.model,
            instructions=_answer_inference_instructions(),
            input=_answer_inference_input(plan=plan, question=question, turn=turn),
            temperature=0,
            max_output_tokens=700,
            timeout=self._config.timeout_seconds,
        )
        payload = _json_from_response(response)
        return _assessment_from_payload(payload)


class FallbackAnswerInferenceProvider:
    """Runs a primary inference provider and falls back to a local strategy."""

    def __init__(
        self,
        *,
        primary: object,
        fallback: object | None = None,
        timeout_seconds: float = DEFAULT_OPENAI_ANSWER_INFERENCE_TIMEOUT_SECONDS,
        on_fallback: Callable[[Exception], None] | None = None,
    ) -> None:
        self._primary = primary
        self._fallback = fallback or HeuristicAnswerInferenceProvider()
        self._timeout_seconds = timeout_seconds
        self._on_fallback = on_fallback

    async def assess_answer(
        self,
        *,
        plan: InterviewPlan,
        question: InterviewQuestion,
        turn: CandidateTurn,
    ) -> CandidateAnswerAssessment:
        try:
            return await asyncio.wait_for(
                self._primary.assess_answer(plan=plan, question=question, turn=turn),
                timeout=self._timeout_seconds,
            )
        except Exception as exc:
            if self._on_fallback:
                self._on_fallback(exc)
            assessment = await self._fallback.assess_answer(
                plan=plan,
                question=question,
                turn=turn,
            )
            reason_codes = [
                *assessment.reason_codes,
                f"llm_fallback:{exc.__class__.__name__}",
            ]
            return CandidateAnswerAssessment(
                classification=assessment.classification,
                reason_codes=reason_codes,
                confidence=assessment.confidence,
                evaluation_matrix=assessment.evaluation_matrix,
            )


def build_live_answer_inference_provider(
    env: Mapping[str, str] | None = None,
) -> object:
    source = env if env is not None else os.environ
    if source.get("OPENAI_ANSWER_INFERENCE_ENABLED", "1") not in {"1", "true", "yes"}:
        return HeuristicAnswerInferenceProvider()
    if not source.get("OPENAI_API_KEY"):
        return HeuristicAnswerInferenceProvider()

    config = OpenAIAnswerInferenceConfig.from_env(source)
    return FallbackAnswerInferenceProvider(
        primary=OpenAIAnswerInferenceProvider(config=config),
        fallback=HeuristicAnswerInferenceProvider(),
        timeout_seconds=config.timeout_seconds + 0.5,
    )


def _openai_responses_client() -> OpenAIResponsesClient:
    try:
        from openai import AsyncOpenAI
    except ImportError as exc:
        raise RuntimeError("openai package is required for OpenAI answer inference") from exc

    return AsyncOpenAI().responses


def _answer_inference_instructions() -> str:
    # Source rationale: docs/sources/evaluation-matrix.md.
    return (
        "You are a strict first-screening interview answer evaluator. "
        "Return only valid JSON. Evaluate whether the candidate answered the active "
        "question, whether they are asking to recover from an interruption, and whether "
        "a recruiter would have enough signal for a first filter. Do not judge accent, "
        "voice, tone, emotion, identity, or protected characteristics. If the answer "
        "mentions protected traits or sensitive personal attributes, ignore those "
        "attributes, add the reason code protected_trait_excluded, and only evaluate "
        "job-related evidence from the answer."
    )


def _answer_inference_input(
    *,
    plan: InterviewPlan,
    question: InterviewQuestion,
    turn: CandidateTurn,
) -> str:
    return json.dumps(
        {
            "role_title": plan.role_title,
            "language": plan.language,
            "interview_style": plan.interview_style.model_dump(mode="json"),
            "active_question": {
                "id": question.id,
                "prompt": question.prompt,
                "category": question.category.value,
                "expected_signal": question.expected_signal,
            },
            "candidate_turn": {
                "transcript": turn.transcript,
                "candidate_intent": turn.candidate_intent.value,
                "is_answer_to_active_question": turn.is_answer_to_active_question,
                "classifier_reason": turn.classifier_reason,
            },
            "allowed_classifications": [item.value for item in AnswerClassification],
            "required_json_shape": {
                "classification": "complete|vague|incomplete|silent|skipped|repeat_requested|wait_requested",
                "reason_codes": [
                    "short_snake_case_reason",
                    "protected_trait_excluded_when_sensitive_attributes_are_mentioned",
                ],
                "confidence": 0.0,
                "scores": {
                    "clarity": 0,
                    "relevance": 0,
                    "concreteness": 0,
                    "coherence": 0,
                    "role_signal": 0,
                },
                "challenge_needed": False,
                "challenge_reason": None,
                "challenge_prompt": None,
            },
        },
        ensure_ascii=False,
    )


def _json_from_response(response: object) -> dict[str, object]:
    output_text = getattr(response, "output_text", None)
    if not isinstance(output_text, str):
        output_text = str(response)
    output_text = _extract_json_object(output_text)
    try:
        payload = json.loads(output_text)
    except json.JSONDecodeError as exc:
        raise ValueError("OpenAI answer inference returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("OpenAI answer inference must return a JSON object")
    return payload


def _extract_json_object(value: str) -> str:
    stripped = value.strip()
    if stripped.startswith("```"):
        stripped = stripped.removeprefix("```json").removeprefix("```").strip()
        stripped = stripped.removesuffix("```").strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return stripped[start : end + 1]
    return stripped


def _assessment_from_payload(payload: dict[str, object]) -> CandidateAnswerAssessment:
    matrix = _matrix_from_payload(payload)
    # Derive the label from the matrix rather than the model's free-form
    # "classification" field: the realtime evaluator sometimes returns a label
    # that contradicts its own scores (e.g. "vague" on a 13/15 answer), which
    # made the interviewer probe strong answers. The scored matrix is the
    # structured signal of record, shared with the local heuristic.
    classification = InterviewOrchestrator.classify_from_matrix(matrix)
    reason_codes = [
        str(item)[:80]
        for item in payload.get("reason_codes", [])
        if isinstance(item, str) and item.strip()
    ]
    confidence = _bounded_float(payload.get("confidence"), default=0.6)
    return CandidateAnswerAssessment(
        classification=classification,
        reason_codes=reason_codes or ["llm_assisted"],
        confidence=confidence,
        evaluation_matrix=matrix,
    )


def _matrix_from_payload(payload: dict[str, object]) -> EvaluationMatrix:
    scores = payload.get("scores")
    if not isinstance(scores, dict):
        scores = {}

    dimensions = [
        _dimension_from_score(EvaluationDimension.CLARITY, scores.get("clarity")),
        _dimension_from_score(EvaluationDimension.RELEVANCE, scores.get("relevance")),
        _dimension_from_score(EvaluationDimension.CONCRETENESS, scores.get("concreteness")),
        _dimension_from_score(EvaluationDimension.COHERENCE, scores.get("coherence")),
        _dimension_from_score(EvaluationDimension.ROLE_SIGNAL, scores.get("role_signal")),
    ]
    return EvaluationMatrix(
        dimensions=dimensions,
        challenge_needed=bool(payload.get("challenge_needed")),
        challenge_reason=_optional_string(payload.get("challenge_reason")),
        challenge_prompt=_optional_string(payload.get("challenge_prompt")),
        evaluator_mode="llm_assisted",
    )


def _dimension_from_score(
    name: EvaluationDimension,
    score: object,
) -> EvaluationMatrixDimension:
    bounded_score = max(0, min(int(score) if isinstance(score, int | float) else 0, 3))
    return EvaluationMatrixDimension(
        name=name,
        score=bounded_score,
        rationale=f"LLM-assisted {name.value} score.",
    )


def _optional_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _bounded_float(value: object, *, default: float) -> float:
    if isinstance(value, int | float):
        return max(0.0, min(float(value), 1.0))
    return default
