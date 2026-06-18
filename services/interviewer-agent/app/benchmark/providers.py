from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Mapping

from app.benchmark.scenarios import BenchmarkScenario
from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.state_machine import INTERVIEWER_STATE_MACHINE_INSTRUCTIONS


class ProviderBenchmarkBlocked(RuntimeError):
    """Raised when a real provider benchmark cannot run in this environment."""


@dataclass(frozen=True)
class ProviderRequirements:
    provider: str
    required_env: tuple[str, ...]


PROVIDER_REQUIREMENTS: dict[str, ProviderRequirements] = {
    "openai_realtime": ProviderRequirements(
        provider="openai_realtime",
        required_env=(
            "OPENAI_API_KEY",
            "OPENAI_REALTIME_MODEL",
            "LIVEKIT_URL",
            "LIVEKIT_API_KEY",
            "LIVEKIT_API_SECRET",
        ),
    ),
    "elevenlabs": ProviderRequirements(
        provider="elevenlabs",
        required_env=(
            "ELEVENLABS_API_KEY",
            "ELEVENLABS_AGENT_ID",
            "LIVEKIT_URL",
            "LIVEKIT_API_KEY",
            "LIVEKIT_API_SECRET",
        ),
    ),
}


class ScriptedBenchmarkProvider:
    """Deterministic provider used to keep benchmark scenarios replayable."""

    def __init__(self, scenario: BenchmarkScenario, provider_name: str) -> None:
        self._scenario = scenario
        self._provider_name = provider_name
        self._turns = {
            question_id: list(turns)
            for question_id, turns in scenario.candidate_turns.items()
        }
        self._answers_by_question: dict[str, int] = defaultdict(int)
        self.system_instructions = INTERVIEWER_STATE_MACHINE_INSTRUCTIONS

    async def start_session(self, plan: InterviewPlan) -> str:
        return (
            "Bonjour, je suis l'interviewer IA de Prelude. "
            f"Nous allons comparer le provider {self._provider_name} "
            f"sur le scenario {self._scenario.name.value} pour le poste {plan.role_title}."
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


def build_benchmark_provider(
    provider: str,
    scenario: BenchmarkScenario,
    env: Mapping[str, str],
) -> ScriptedBenchmarkProvider:
    if provider == "mock_openai_realtime":
        return ScriptedBenchmarkProvider(scenario, provider_name=provider)

    requirements = PROVIDER_REQUIREMENTS.get(provider)
    if requirements is None:
        supported = ", ".join(["mock_openai_realtime", *PROVIDER_REQUIREMENTS.keys()])
        raise ProviderBenchmarkBlocked(
            f"Unsupported provider '{provider}'. Supported providers: {supported}."
        )

    missing = [key for key in requirements.required_env if not env.get(key)]
    if missing:
        raise ProviderBenchmarkBlocked(
            f"{provider} benchmark requires missing environment variables: "
            f"{', '.join(missing)}."
        )

    raise ProviderBenchmarkBlocked(
        f"{provider} credentials are present, but the real media benchmark adapter "
        "still needs a LiveKit room session to run. Use the mock provider for local "
        "harness validation, then run the real provider smoke from a LiveKit-enabled worker."
    )
