from __future__ import annotations

from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.orchestrator import CandidateAnswerAssessment, InterviewOrchestrator


class HeuristicAnswerInferenceProvider:
    """Fast local strategy for live answer scoring.

    This keeps the critical live-interview path low-latency. LLM-backed providers
    such as OpenAI or Vertex should implement the same `assess_answer` method and
    keep a strict timeout/fallback to this strategy.
    """

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
