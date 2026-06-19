from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
    ABSURD_ANSWER = "absurd_answer"
    OFF_TOPIC = "off_topic"
    LOW_INFORMATION = "low_information"
    CONTRADICTORY = "contradictory"
    GENERIC_CLAIM = "generic_claim"


@dataclass(frozen=True)
class BenchmarkScenario:
    name: BenchmarkScenarioName
    description: str
    plan: InterviewPlan
    candidate_turns: dict[str, list[CandidateTurn]]
    simulate_barge_in: bool = False


def load_benchmark_scenario(name: BenchmarkScenarioName) -> BenchmarkScenario:
    plan = create_demo_plan()
    turns = {question.id: [_normal_turn(question)] for question in plan.questions}
    simulate_barge_in = False
    description = "Candidate answers each planned question directly."

    if name == BenchmarkScenarioName.INTERRUPT:
        simulate_barge_in = True
        description = "Candidate barges in during the first interviewer question."
    elif name == BenchmarkScenarioName.REPEAT:
        first_question = plan.questions[0].id
        turns[first_question] = [
            _turn(
                question_id=first_question,
                transcript="Pouvez-vous repeter la question ?",
                repeat_requested=True,
            ),
            _normal_turn(plan.questions[0]),
        ]
        description = "Candidate asks the IA interviewer to repeat the first question."
    elif name == BenchmarkScenarioName.SILENCE:
        first_question = plan.questions[0].id
        turns[first_question] = [
            _turn(question_id=first_question, transcript="", is_complete=False),
            _normal_turn(plan.questions[0]),
        ]
        description = "Candidate is initially silent, then recovers after one soft prompt."
    elif name == BenchmarkScenarioName.VAGUE:
        first_question = plan.questions[0].id
        turns[first_question] = [
            _turn(
                question_id=first_question,
                transcript="J'ai travaille sur ce sujet, mais c'est assez large.",
            ),
            _turn(
                question_id=first_question,
                transcript="Plus precisement, j'ai priorise une roadmap en arbitrant impact client, risque technique et delai.",
                offset_seconds=2,
            ),
        ]
        description = "Candidate gives a vague answer requiring one controlled follow-up."
    elif name == BenchmarkScenarioName.NOISE:
        first_question = plan.questions[0].id
        turns[first_question] = [
            _turn(
                question_id=first_question,
                transcript="[background noise]",
                is_complete=False,
            ),
            _normal_turn(plan.questions[0]),
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
    elif name == BenchmarkScenarioName.ABSURD_ANSWER:
        first_question = plan.questions[0].id
        turns[first_question] = [
            _turn(question_id=first_question, transcript="caca"),
            _turn(
                question_id=first_question,
                transcript=(
                    "Je suis interesse par ce poste produit B2B parce que je veux "
                    "travailler proche des clients et apprendre sur les arbitrages roadmap."
                ),
                offset_seconds=2,
            ),
        ]
        description = "Candidate gives an absurd answer, then recovers after a challenge."
    elif name == BenchmarkScenarioName.OFF_TOPIC:
        second_question = plan.questions[1].id
        turns[second_question] = [
            _turn(
                question_id=second_question,
                transcript="Il fait beau aujourd'hui et je prefere parler de football.",
            ),
            _turn(
                question_id=second_question,
                transcript=(
                    "J'ai priorise une roadmap sous contrainte client en comparant "
                    "impact, risque technique et delai."
                ),
                offset_seconds=2,
            ),
        ]
        description = "Candidate answers off-topic before being challenged."
    elif name == BenchmarkScenarioName.LOW_INFORMATION:
        first_question = plan.questions[0].id
        turns[first_question] = [
            _turn(question_id=first_question, transcript="Je ne sais pas trop."),
            _turn(
                question_id=first_question,
                transcript=(
                    "Le poste m'interesse pour le contexte produit B2B et le travail "
                    "avec les clients et les equipes internes."
                ),
                offset_seconds=2,
            ),
        ]
        description = "Candidate gives a low-information answer, then clarifies."
    elif name == BenchmarkScenarioName.CONTRADICTORY:
        second_question = plan.questions[1].id
        turns[second_question] = [
            _turn(
                question_id=second_question,
                transcript=(
                    "J'ai priorise la roadmap mais je n'ai jamais priorise de roadmap "
                    "ni travaille avec des clients."
                ),
            ),
            _turn(
                question_id=second_question,
                transcript=(
                    "Pour clarifier, j'ai priorise un sujet client en arbitrant impact, "
                    "complexite technique et urgence commerciale."
                ),
                offset_seconds=2,
            ),
        ]
        description = "Candidate gives a contradictory answer before clarifying."
    elif name == BenchmarkScenarioName.GENERIC_CLAIM:
        second_question = plan.questions[1].id
        turns[second_question] = [
            _turn(question_id=second_question, transcript="Je suis motive et tres bon."),
            _turn(
                question_id=second_question,
                transcript=(
                    "Concretement, j'ai gere une demande client urgente en priorisant "
                    "la roadmap avec l'equipe produit et support."
                ),
                offset_seconds=2,
            ),
        ]
        description = "Candidate makes a generic claim before giving evidence."

    return BenchmarkScenario(
        name=name,
        description=description,
        plan=plan,
        candidate_turns=turns,
        simulate_barge_in=simulate_barge_in,
    )


def _normal_turn(question) -> CandidateTurn:
    if question.category.value == "motivation":
        transcript = (
            "Je suis interesse par ce poste produit B2B parce que je veux travailler "
            "proche des clients, avec une equipe qui arbitre la roadmap sur des signaux concrets."
        )
    elif question.category.value == "experience":
        transcript = (
            "J'ai priorise une roadmap sous contraintes clients: j'ai compare impact, "
            "risque technique et delai, puis mesure le resultat sur le churn."
        )
    elif question.category.value == "logistics":
        transcript = "Je suis disponible dans deux semaines et je peux travailler en hybride."
    else:
        transcript = (
            "Je peux repondre avec un exemple concret, les contraintes, "
            "la decision prise et le resultat obtenu."
        )

    return _turn(question.id, transcript)


def _turn(
    question_id: str,
    transcript: str,
    *,
    offset_seconds: int = 0,
    is_complete: bool = True,
    repeat_requested: bool = False,
    skip_requested: bool = False,
    wait_requested: bool = False,
) -> CandidateTurn:
    started_at = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(
        seconds=offset_seconds
    )
    return CandidateTurn(
        question_id=question_id,
        transcript=transcript,
        is_complete=is_complete,
        repeat_requested=repeat_requested,
        skip_requested=skip_requested,
        wait_requested=wait_requested,
        started_at=started_at,
        ended_at=started_at + timedelta(seconds=1),
    )
