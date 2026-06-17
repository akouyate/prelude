from __future__ import annotations

from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.state_machine import INTERVIEWER_STATE_MACHINE_INSTRUCTIONS


class MockOpenAIRealtimeAdapter:
    """Deterministic provider boundary for the POC before real OpenAI wiring."""

    def __init__(self) -> None:
        self._answers_by_question: dict[str, int] = {}
        self.system_instructions = INTERVIEWER_STATE_MACHINE_INSTRUCTIONS

    async def start_session(self, plan: InterviewPlan) -> str:
        return (
            "Bonjour, je suis l'interviewer IA de Prelude. "
            f"Nous allons faire un premier entretien court pour le poste {plan.role_title}."
        )

    async def ask_question(self, question: InterviewQuestion) -> str:
        return question.prompt

    async def listen_for_answer(self, question: InterviewQuestion) -> CandidateTurn:
        count = self._answers_by_question.get(question.id, 0)
        self._answers_by_question[question.id] = count + 1

        if count == 0 and question.follow_up_prompt:
            transcript = "J'ai une experience pertinente, mais je peux donner plus de details."
        else:
            transcript = (
                "Je peux illustrer avec un exemple concret, les contraintes, "
                "la decision prise et le resultat obtenu."
            )

        return CandidateTurn(question_id=question.id, transcript=transcript)

    async def should_follow_up(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
        followups_used: int,
        max_followups: int,
    ) -> bool:
        return (
            question.follow_up_prompt is not None
            and followups_used < max_followups
            and "plus de details" in turn.transcript
        )

    async def ask_follow_up(self, question: InterviewQuestion) -> str:
        return question.follow_up_prompt or "Pouvez-vous preciser votre reponse ?"

    async def close_session(self) -> str:
        return "Merci, l'entretien est termine. Le recruteur recevra un resume structure."
