from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum

from app.domain.models import (
    CandidateTurn,
    InterviewPlan,
    InterviewQuestion,
    InterviewStyle,
    QuestionCategory,
    create_demo_plan,
)


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
    CMO = "cmo"
    BUYER = "buyer"
    HR = "hr"
    AI_ORCHESTRATOR = "ai_orchestrator"
    CMO_VAGUE = "cmo_vague"
    BUYER_OFF_TOPIC = "buyer_off_topic"
    HR_CONTRADICTORY = "hr_contradictory"
    AI_ORCHESTRATOR_LOW_INFORMATION = "ai_orchestrator_low_information"


@dataclass(frozen=True)
class BenchmarkScenario:
    name: BenchmarkScenarioName
    description: str
    plan: InterviewPlan
    candidate_turns: dict[str, list[CandidateTurn]]
    simulate_barge_in: bool = False


def load_benchmark_scenario(name: BenchmarkScenarioName) -> BenchmarkScenario:
    role_scenario = _load_role_specific_scenario(name)
    if role_scenario is not None:
        return role_scenario

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


def _load_role_specific_scenario(
    name: BenchmarkScenarioName,
) -> BenchmarkScenario | None:
    weak_role_scenario = _load_weak_role_scenario(name)
    if weak_role_scenario is not None:
        return weak_role_scenario

    if name == BenchmarkScenarioName.CMO:
        return _role_specific_scenario(
            name=name,
            description="Candidate screens for a CMO role with brand, pipeline, and budget ownership.",
            plan=InterviewPlan(
                id="plan-benchmark-cmo",
                role_title="CMO",
                interview_style=InterviewStyle(
                    sector="B2B SaaS",
                    seniority="executive",
                    work_environment="leadership team with sales, product, and revenue pressure",
                    role_constraints=[
                        "own brand positioning and demand generation",
                        "align marketing budget with sales pipeline",
                        "measure acquisition impact and customer revenue quality",
                    ],
                    company_context=(
                        "Prelude is screening a senior marketing leader before recruiter review."
                    ),
                    candidate_tone="strategic, direct, and evidence-led",
                ),
                questions=[
                    InterviewQuestion(
                        id="q1",
                        prompt="Pouvez-vous vous presenter et expliquer ce qui vous interesse dans ce poste de CMO ?",
                        category=QuestionCategory.MOTIVATION,
                        follow_up_prompt="Quel signal marketing vous attire le plus dans ce contexte ?",
                    ),
                    InterviewQuestion(
                        id="q2",
                        prompt="Donnez un exemple ou vous avez aligne brand, demand generation et sales pipeline avec un budget contraint.",
                        category=QuestionCategory.EXPERIENCE,
                        follow_up_prompt="Quel arbitrage budget avez-vous fait et quel impact pipeline avez-vous mesure ?",
                    ),
                    InterviewQuestion(
                        id="q3",
                        prompt="Quelles sont vos disponibilites et contraintes pour la suite du process ?",
                        category=QuestionCategory.LOGISTICS,
                    ),
                ],
            ),
            answers={
                "q1": (
                    "Ce poste CMO m'interesse parce que j'ai deja aligne brand, "
                    "acquisition et sales avec un budget contraint; exemple recent, "
                    "decision de couper deux canaux et resultat pipeline en hausse de 18%."
                ),
                "q2": (
                    "J'ai gere un budget marketing sous contrainte client et sales: "
                    "decision de deplacer 30% du paid vers contenu et partner, impact "
                    "pipeline plus qualifie et meilleur resultat revenue."
                ),
                "q3": (
                    "Je suis disponible dans quatre semaines, hybride possible, avec "
                    "une contrainte de preavis executive deja partagee."
                ),
            },
        )

    if name == BenchmarkScenarioName.BUYER:
        return _role_specific_scenario(
            name=name,
            description="Candidate screens for a buyer role with supplier, cost, and lead-time ownership.",
            plan=InterviewPlan(
                id="plan-benchmark-buyer",
                role_title="Acheteur",
                interview_style=InterviewStyle(
                    sector="industrial procurement",
                    seniority="mid-level",
                    work_environment="supplier negotiation with operations and finance",
                    role_constraints=[
                        "negotiate supplier cost and contract terms",
                        "secure lead time and quality under operational constraints",
                        "communicate savings, risk, and delivery impact",
                    ],
                    company_context=(
                        "Prelude is screening a procurement candidate before recruiter review."
                    ),
                    candidate_tone="practical, precise, and numbers-oriented",
                ),
                questions=[
                    InterviewQuestion(
                        id="q1",
                        prompt="Pouvez-vous vous presenter et expliquer ce qui vous interesse dans ce poste d'acheteur ?",
                        category=QuestionCategory.MOTIVATION,
                        follow_up_prompt="Quel aspect achat ou fournisseur vous motive le plus ?",
                    ),
                    InterviewQuestion(
                        id="q2",
                        prompt="Parlez-moi d'un exemple de negociation fournisseur avec une contrainte de cout, delai ou qualite.",
                        category=QuestionCategory.EXPERIENCE,
                        follow_up_prompt="Quel compromis avez-vous pris et quel resultat avez-vous obtenu ?",
                    ),
                    InterviewQuestion(
                        id="q3",
                        prompt="Quelles sont vos disponibilites et contraintes de mobilite ou de preavis ?",
                        category=QuestionCategory.LOGISTICS,
                    ),
                ],
            ),
            answers={
                "q1": (
                    "Le poste d'acheteur m'interesse car j'aime relier fournisseur, "
                    "cout et operations; exemple, j'ai securise un contrat client "
                    "avec impact delai et resultat savings clair."
                ),
                "q2": (
                    "J'ai negocie avec un fournisseur critique sous contrainte qualite "
                    "et delai: decision de split volume, impact risque reduit, resultat "
                    "8% de savings et livraison maintenue."
                ),
                "q3": (
                    "Je suis disponible dans trois semaines, mobile deux jours par semaine "
                    "et sans contrainte fournisseur ou preavis supplementaire."
                ),
            },
        )

    if name == BenchmarkScenarioName.HR:
        return _role_specific_scenario(
            name=name,
            description="Candidate screens for an HR role with employee relations, hiring, and compliance signals.",
            plan=InterviewPlan(
                id="plan-benchmark-hr",
                role_title="Responsable RH",
                interview_style=InterviewStyle(
                    sector="multi-site services",
                    seniority="senior",
                    work_environment="people operations with managers, employees, and compliance pressure",
                    role_constraints=[
                        "support managers on employee relations",
                        "coordinate hiring and onboarding with operational teams",
                        "handle compliance, conflict, and sensitive communication",
                    ],
                    company_context=(
                        "Prelude is screening an HR leader before recruiter review."
                    ),
                    candidate_tone="calm, structured, and human",
                ),
                questions=[
                    InterviewQuestion(
                        id="q1",
                        prompt="Pouvez-vous vous presenter et expliquer ce qui vous interesse dans ce role RH ?",
                        category=QuestionCategory.MOTIVATION,
                        follow_up_prompt="Quel enjeu humain vous attire dans ce contexte ?",
                    ),
                    InterviewQuestion(
                        id="q2",
                        prompt="Donnez un exemple ou vous avez accompagne un manager sur un sujet employee relations ou onboarding.",
                        category=QuestionCategory.EXPERIENCE,
                        follow_up_prompt="Comment avez-vous gere la communication sensible et le resultat ?",
                    ),
                    InterviewQuestion(
                        id="q3",
                        prompt="Quelles sont vos disponibilites et contraintes pour rejoindre l'equipe ?",
                        category=QuestionCategory.LOGISTICS,
                    ),
                ],
            ),
            answers={
                "q1": (
                    "Ce role RH m'interesse pour accompagner managers et employees "
                    "avec une approche concrete; exemple, j'ai structure onboarding "
                    "et communication, avec impact sur retention equipe."
                ),
                "q2": (
                    "J'ai accompagne un manager sur employee relations avec contrainte "
                    "compliance: decision de cadrer les faits, communication claire, "
                    "resultat conflit apaise et plan onboarding ajuste."
                ),
                "q3": (
                    "Je suis disponible dans un mois, hybride possible, aucune contrainte "
                    "de mobilite sauf deux jours fixes sur site."
                ),
            },
        )

    if name == BenchmarkScenarioName.AI_ORCHESTRATOR:
        return _role_specific_scenario(
            name=name,
            description="Candidate screens for an AI orchestrator role with agent workflow and evaluation ownership.",
            plan=InterviewPlan(
                id="plan-benchmark-ai-orchestrator",
                role_title="Orchestrateur IA",
                interview_style=InterviewStyle(
                    sector="AI operations",
                    seniority="senior",
                    work_environment="cross-functional AI workflow design with product, data, and operations",
                    role_constraints=[
                        "orchestrate AI agents and human handoffs",
                        "monitor evaluation metrics, latency, and quality",
                        "coordinate product, data, and operations teams",
                    ],
                    company_context=(
                        "Prelude is screening an AI workflow owner before recruiter review."
                    ),
                    candidate_tone="systems-oriented, pragmatic, and precise",
                ),
                questions=[
                    InterviewQuestion(
                        id="q1",
                        prompt="Pouvez-vous vous presenter et expliquer ce qui vous interesse dans ce role d'orchestrateur IA ?",
                        category=QuestionCategory.MOTIVATION,
                        follow_up_prompt="Quel type de workflow IA vous attire le plus ?",
                    ),
                    InterviewQuestion(
                        id="q2",
                        prompt="Donnez un exemple ou vous avez orchestre un workflow avec agents IA, evaluation et handoff humain.",
                        category=QuestionCategory.EXPERIENCE,
                        follow_up_prompt="Quel signal qualite ou latence avez-vous mesure ?",
                    ),
                    InterviewQuestion(
                        id="q3",
                        prompt="Quelles sont vos disponibilites et contraintes pour la suite du process ?",
                        category=QuestionCategory.LOGISTICS,
                    ),
                ],
            ),
            answers={
                "q1": (
                    "Ce role d'orchestrateur IA m'interesse car j'ai construit des "
                    "workflows agent, data et operations; exemple, decision de garder "
                    "human handoff sur cas sensibles avec impact qualite mesurable."
                ),
                "q2": (
                    "J'ai orchestre un workflow avec agents IA, evaluation matrix et "
                    "handoff humain: contrainte latence, decision de paralleliser les "
                    "checks, resultat qualite plus stable et delai reduit de 25%."
                ),
                "q3": (
                    "Je suis disponible dans deux semaines, remote ou hybride possible, "
                    "sans contrainte particuliere pour les ateliers product et data."
                ),
            },
        )

    return None


def _load_weak_role_scenario(
    name: BenchmarkScenarioName,
) -> BenchmarkScenario | None:
    if name == BenchmarkScenarioName.CMO_VAGUE:
        return _with_weak_answer(
            base=BenchmarkScenarioName.CMO,
            name=name,
            description=(
                "CMO candidate gives a vague pipeline answer before clarifying "
                "with budget, channel, and impact evidence."
            ),
            question_id="q2",
            weak_answer="J'ai travaille sur ce sujet, mais c'est assez large.",
            recovery_answer=(
                "Plus precisement, j'ai arbitre un budget CMO en coupant deux "
                "canaux paid, puis reinvesti dans partner et contenu; resultat "
                "pipeline qualifie en hausse de 18%."
            ),
        )

    if name == BenchmarkScenarioName.BUYER_OFF_TOPIC:
        return _with_weak_answer(
            base=BenchmarkScenarioName.BUYER,
            name=name,
            description=(
                "Buyer candidate answers off-topic before returning to supplier, "
                "cost, quality, and lead-time evidence."
            ),
            question_id="q2",
            weak_answer="Il fait beau aujourd'hui et je prefere parler de football.",
            recovery_answer=(
                "Pour revenir a la negociation fournisseur, j'ai split le volume "
                "entre deux fournisseurs sous contrainte qualite et delai; resultat "
                "8% de savings et livraison maintenue."
            ),
        )

    if name == BenchmarkScenarioName.HR_CONTRADICTORY:
        return _with_weak_answer(
            base=BenchmarkScenarioName.HR,
            name=name,
            description=(
                "HR candidate gives a contradictory employee-relations answer "
                "before clarifying the manager support process."
            ),
            question_id="q2",
            weak_answer=(
                "J'ai accompagne un manager sur employee relations mais je n'ai jamais "
                "accompagne de manager ni gere de sujet RH sensible."
            ),
            recovery_answer=(
                "Je clarifie: j'ai accompagne un manager avec une contrainte compliance, "
                "cadre les faits, prepare une communication sensible et obtenu un plan "
                "d'onboarding plus clair."
            ),
        )

    if name == BenchmarkScenarioName.AI_ORCHESTRATOR_LOW_INFORMATION:
        return _with_weak_answer(
            base=BenchmarkScenarioName.AI_ORCHESTRATOR,
            name=name,
            description=(
                "AI orchestrator candidate gives a low-information answer before "
                "explaining agent workflow, evaluation, latency, and human handoff."
            ),
            question_id="q1",
            weak_answer="Je ne sais pas trop.",
            recovery_answer=(
                "Le role m'interesse parce que j'ai orchestre des workflows agents IA "
                "avec data, operations, evaluation matrix et human handoff; resultat "
                "qualite plus stable et latence reduite."
            ),
        )

    return None


def _with_weak_answer(
    *,
    base: BenchmarkScenarioName,
    name: BenchmarkScenarioName,
    description: str,
    question_id: str,
    weak_answer: str,
    recovery_answer: str,
) -> BenchmarkScenario:
    base_scenario = _load_role_specific_scenario(base)
    if base_scenario is None:
        raise ValueError(f"Unknown base role scenario {base}")

    candidate_turns = {
        current_question_id: list(turns)
        for current_question_id, turns in base_scenario.candidate_turns.items()
    }
    candidate_turns[question_id] = [
        _turn(question_id=question_id, transcript=weak_answer),
        _turn(question_id=question_id, transcript=recovery_answer, offset_seconds=2),
    ]

    return BenchmarkScenario(
        name=name,
        description=description,
        plan=base_scenario.plan,
        candidate_turns=candidate_turns,
    )


def _role_specific_scenario(
    *,
    name: BenchmarkScenarioName,
    description: str,
    plan: InterviewPlan,
    answers: dict[str, str],
) -> BenchmarkScenario:
    return BenchmarkScenario(
        name=name,
        description=description,
        plan=plan,
        candidate_turns={
            question.id: [_turn(question_id=question.id, transcript=answers[question.id])]
            for question in plan.questions
        },
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
