from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.domain.models import CandidateTurn, InterviewPlan, create_demo_plan


class BenchmarkScenarioName(StrEnum):
    NORMAL = "normal"
    INTERRUPT = "interrupt"
    REPEAT = "repeat"
    SILENCE = "silence"
    VAGUE = "vague"
    NOISE = "noise"
    AUDIO_ONLY = "audio_only"
    VIDEO_ENABLED = "video_enabled"


@dataclass(frozen=True)
class BenchmarkScenario:
    name: BenchmarkScenarioName
    description: str
    plan: InterviewPlan
    candidate_turns: dict[str, list[CandidateTurn]]
    simulate_barge_in: bool = False


def load_benchmark_scenario(name: BenchmarkScenarioName) -> BenchmarkScenario:
    plan = create_demo_plan()
    turns = {question.id: [_normal_turn(question.id)] for question in plan.questions}
    simulate_barge_in = False
    description = "Candidate answers each planned question directly."

    if name == BenchmarkScenarioName.INTERRUPT:
        simulate_barge_in = True
        description = "Candidate barges in during the first interviewer question."
    elif name == BenchmarkScenarioName.REPEAT:
        first_question = plan.questions[0].id
        turns[first_question] = [
            CandidateTurn(
                question_id=first_question,
                transcript="Pouvez-vous repeter la question ?",
                repeat_requested=True,
            ),
            _normal_turn(first_question),
        ]
        description = "Candidate asks the IA interviewer to repeat the first question."
    elif name == BenchmarkScenarioName.SILENCE:
        first_question = plan.questions[0].id
        turns[first_question] = [
            CandidateTurn(question_id=first_question, transcript="", is_complete=False),
            _normal_turn(first_question),
        ]
        description = "Candidate is initially silent, then recovers after one soft prompt."
    elif name == BenchmarkScenarioName.VAGUE:
        first_question = plan.questions[0].id
        turns[first_question] = [
            CandidateTurn(
                question_id=first_question,
                transcript="J'ai travaille sur ce sujet, mais c'est assez large.",
            ),
            CandidateTurn(
                question_id=first_question,
                transcript="Plus precisement, j'ai priorise une roadmap en arbitrant impact client, risque technique et delai.",
            ),
        ]
        description = "Candidate gives a vague answer requiring one controlled follow-up."
    elif name == BenchmarkScenarioName.NOISE:
        first_question = plan.questions[0].id
        turns[first_question] = [
            CandidateTurn(
                question_id=first_question,
                transcript="[background noise]",
                is_complete=False,
            ),
            _normal_turn(first_question),
        ]
        description = "Candidate audio starts with noise before a usable answer."
    elif name == BenchmarkScenarioName.AUDIO_ONLY:
        plan.allow_video = False
        plan.allow_audio_only = True
        description = "Candidate completes the interview in audio-only mode."
    elif name == BenchmarkScenarioName.VIDEO_ENABLED:
        plan.allow_video = True
        plan.allow_audio_only = True
        description = "Candidate joins with video enabled, while scoring remains content-only."

    return BenchmarkScenario(
        name=name,
        description=description,
        plan=plan,
        candidate_turns=turns,
        simulate_barge_in=simulate_barge_in,
    )


def _normal_turn(question_id: str) -> CandidateTurn:
    return CandidateTurn(
        question_id=question_id,
        transcript=(
            "Je peux repondre avec un exemple concret, les contraintes, "
            "la decision prise et le resultat obtenu."
        ),
    )
