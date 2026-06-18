from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.adapters.openai_realtime_probe import (
    OpenAIRealtimeConfig,
    OpenAIRealtimeSessionProbe,
    RealtimeModelFactory,
)
from app.benchmark.scenarios import BenchmarkScenario
from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.state_machine import INTERVIEWER_STATE_MACHINE_INSTRUCTIONS


class OpenAIRealtimeSmokeProvider:
    """OpenAI Realtime smoke adapter with deterministic candidate turns.

    The real provider boundary is exercised through a short OpenAI Realtime
    handshake. Candidate answers remain scripted so benchmark scenarios stay
    replayable until the candidate UI/media path exists.
    """

    def __init__(
        self,
        scenario: BenchmarkScenario,
        config: OpenAIRealtimeConfig,
        *,
        realtime_model_factory: RealtimeModelFactory | None = None,
    ) -> None:
        self._scenario = scenario
        self._config = config
        self._realtime_model_factory = realtime_model_factory
        self._turns = {
            question_id: list(turns)
            for question_id, turns in scenario.candidate_turns.items()
        }
        self._answers_by_question: dict[str, int] = defaultdict(int)
        self.system_instructions = INTERVIEWER_STATE_MACHINE_INSTRUCTIONS
        self.smoke_metadata: dict[str, object] = {
            "openai_realtime": {
                "smoke_status": "not_started",
                "model": config.model,
                "voice": config.voice,
                "turn_detection": config.turn_detection,
                "reasoning_effort": config.reasoning_effort,
            }
        }

    async def prepare_smoke(self) -> dict[str, object]:
        metadata = await OpenAIRealtimeSessionProbe(
            self._config,
            realtime_model_factory=self._realtime_model_factory,
        ).connect()
        self.smoke_metadata = {"openai_realtime": metadata}
        return dict(self.smoke_metadata)

    async def start_session(self, plan: InterviewPlan) -> str:
        return (
            "Bonjour, je suis l'interviewer IA de Prelude. "
            "Nous allons valider le chemin OpenAI Realtime et LiveKit "
            f"pour le poste {plan.role_title}."
        )

    async def ask_question(self, question: InterviewQuestion) -> str:
        return question.prompt

    async def listen_for_answer(self, question: InterviewQuestion) -> CandidateTurn:
        self._answers_by_question[question.id] += 1
        queued_turns = self._turns.get(question.id) or []
        if queued_turns:
            turn = queued_turns.pop(0)
            self._turns[question.id] = queued_turns
            return turn
        return CandidateTurn(
            question_id=question.id,
            transcript="Je peux completer avec un exemple concret et mes contraintes de disponibilite.",
            started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ended_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=1),
        )

    async def should_follow_up(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
        followups_used: int,
        max_followups: int,
    ) -> bool:
        if followups_used >= max_followups:
            return False
        if self._scenario.name.value == "vague" and question.follow_up_prompt:
            return self._answers_by_question[question.id] == 1
        return False

    async def ask_follow_up(self, question: InterviewQuestion) -> str:
        return question.follow_up_prompt or "Pouvez-vous preciser votre reponse ?"

    async def close_session(self) -> str:
        return "Merci, l'entretien est termine. Le recruteur recevra un resume structure."
