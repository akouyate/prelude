import pytest

from app.domain.models import (
    CandidateTurn,
    InterviewPlan,
    InterviewQuestion,
    QuestionCategory,
)
from app.domain.orchestrator import (
    AnswerClassification,
    EvaluationDimension,
    InterviewOrchestrator,
    OrchestratorCommandType,
    PolicyAction,
)


def three_question_plan() -> InterviewPlan:
    return InterviewPlan(
        id="plan-test",
        role_title="Customer Success Manager",
        max_followups_per_question=1,
        questions=[
            InterviewQuestion(
                id="q1",
                prompt="Why are you interested?",
                category=QuestionCategory.MOTIVATION,
            ),
            InterviewQuestion(
                id="q2",
                prompt="Tell me about a customer situation.",
                category=QuestionCategory.EXPERIENCE,
                follow_up_prompt="What did you do next?",
            ),
            InterviewQuestion(
                id="q3",
                prompt="What are your availabilities?",
                category=QuestionCategory.LOGISTICS,
            ),
        ],
    )


def test_orchestrator_completes_three_questions_in_order() -> None:
    orchestrator = InterviewOrchestrator(three_question_plan())

    command = orchestrator.start()
    assert command.type == OrchestratorCommandType.ASK_QUESTION
    assert command.question_id == "q1"
    assert command.question_index == 0

    for expected_index, question_id in enumerate(["q1", "q2", "q3"]):
        orchestrator.mark_question_asked(question_id)
        decision = orchestrator.evaluate_answer(
            classification=AnswerClassification.COMPLETE,
            turn_ids=[f"turn-{question_id}"],
        )

        assert decision.answer_evaluation.question_id == question_id
        assert decision.answer_evaluation.question_index == expected_index
        assert decision.answer_evaluation.policy_action == PolicyAction.COMPLETE_QUESTION
        assert decision.commands[0].type == OrchestratorCommandType.COMPLETE_QUESTION
        assert decision.commands[0].question_index == expected_index

        next_command = orchestrator.mark_question_completed(question_id, "answered")
        if expected_index < 2:
            assert next_command.type == OrchestratorCommandType.ASK_QUESTION
            assert next_command.question_index == expected_index + 1
        else:
            assert next_command.type == OrchestratorCommandType.CLOSE_SESSION
            assert next_command.completed_questions == 3
            assert next_command.total_questions == 3

    orchestrator.mark_session_closed()
    assert orchestrator.terminal_reason == "all_questions_completed"


def test_vague_answer_gets_one_followup_then_completes() -> None:
    orchestrator = InterviewOrchestrator(three_question_plan())
    command = orchestrator.start()
    orchestrator.mark_question_asked(command.question_id)

    first = orchestrator.evaluate_answer(
        classification=AnswerClassification.VAGUE,
        turn_ids=["turn-1"],
        reason_codes=["too_generic"],
        confidence=0.71,
    )

    assert first.answer_evaluation.attempt_index == 1
    assert first.answer_evaluation.reason_codes == ["too_generic"]
    assert first.answer_evaluation.policy_action == PolicyAction.ASK_FOLLOWUP
    assert first.commands[0].type == OrchestratorCommandType.ASK_FOLLOWUP
    assert first.commands[0].followups_used == 1

    second = orchestrator.evaluate_answer(
        classification=AnswerClassification.VAGUE,
        turn_ids=["turn-2"],
        reason_codes=["missing_example"],
    )

    assert second.answer_evaluation.attempt_index == 2
    assert second.answer_evaluation.policy_action == PolicyAction.COMPLETE_QUESTION
    assert second.commands[0].type == OrchestratorCommandType.COMPLETE_QUESTION
    assert second.commands[0].completion_reason == "answered"


def test_incomplete_answer_gets_one_soft_reprompt_then_timeboxes_question() -> None:
    orchestrator = InterviewOrchestrator(three_question_plan())
    command = orchestrator.start()
    orchestrator.mark_question_asked(command.question_id)

    first = orchestrator.evaluate_answer(
        classification=AnswerClassification.INCOMPLETE,
        turn_ids=["turn-1"],
    )

    assert first.answer_evaluation.policy_action == PolicyAction.SOFT_REPROMPT
    assert first.commands[0].type == OrchestratorCommandType.SOFT_REPROMPT
    assert first.commands[0].reprompts_used == 1

    second = orchestrator.evaluate_answer(
        classification=AnswerClassification.SILENT,
        turn_ids=["turn-2"],
        reason_codes=["candidate_silent"],
    )

    assert second.answer_evaluation.policy_action == PolicyAction.TIMEBOX
    assert second.commands[0].type == OrchestratorCommandType.COMPLETE_QUESTION
    assert second.commands[0].completion_reason == "candidate_silent"


def test_repeat_wait_and_skip_do_not_consume_followups_or_reprompts() -> None:
    orchestrator = InterviewOrchestrator(three_question_plan())
    command = orchestrator.start()
    orchestrator.mark_question_asked(command.question_id)

    repeat = orchestrator.evaluate_answer(
        classification=AnswerClassification.REPEAT_REQUESTED,
        turn_ids=["turn-repeat"],
    )
    assert repeat.answer_evaluation.policy_action == PolicyAction.REPEAT_QUESTION
    assert repeat.commands[0].type == OrchestratorCommandType.REPEAT_QUESTION

    wait = orchestrator.evaluate_answer(
        classification=AnswerClassification.WAIT_REQUESTED,
        turn_ids=["turn-wait"],
    )
    assert wait.answer_evaluation.policy_action == PolicyAction.WAIT
    assert wait.commands[0].type == OrchestratorCommandType.WAIT

    skip = orchestrator.evaluate_answer(
        classification=AnswerClassification.SKIPPED,
        turn_ids=["turn-skip"],
    )
    assert skip.answer_evaluation.policy_action == PolicyAction.MARK_SKIPPED
    assert skip.commands[0].type == OrchestratorCommandType.COMPLETE_QUESTION
    assert skip.commands[0].completion_reason == "skipped"

    assert orchestrator.followups_used("q1") == 0
    assert orchestrator.reprompts_used("q1") == 0


def test_classifies_candidate_turn_without_llm_for_deterministic_signals() -> None:
    assert (
        InterviewOrchestrator.classify_candidate_turn(
            CandidateTurn(question_id="q1", transcript="Pouvez-vous repeter ?", repeat_requested=True)
        )
        == AnswerClassification.REPEAT_REQUESTED
    )
    assert (
        InterviewOrchestrator.classify_candidate_turn(
            CandidateTurn(question_id="q1", transcript="Une seconde", wait_requested=True)
        )
        == AnswerClassification.WAIT_REQUESTED
    )
    assert (
        InterviewOrchestrator.classify_candidate_turn(
            CandidateTurn(question_id="q1", transcript="Je passe", skip_requested=True)
        )
        == AnswerClassification.SKIPPED
    )
    assert (
        InterviewOrchestrator.classify_candidate_turn(
            CandidateTurn(question_id="q1", transcript="", is_complete=False)
        )
        == AnswerClassification.SILENT
    )


def test_matrix_challenges_absurd_answer_instead_of_accepting_text() -> None:
    plan = three_question_plan()
    question = plan.questions[0]

    assessment = InterviewOrchestrator.assess_candidate_turn(
        plan=plan,
        question=question,
        turn=CandidateTurn(question_id=question.id, transcript="caca"),
    )

    assert assessment.classification == AnswerClassification.VAGUE
    assert assessment.evaluation_matrix is not None
    assert assessment.evaluation_matrix.challenge_needed is True
    assert assessment.evaluation_matrix.challenge_reason == "incoherent_or_absurd_answer"
    assert assessment.evaluation_matrix.dimension_score(EvaluationDimension.COHERENCE) == 0

    orchestrator = InterviewOrchestrator(plan)
    command = orchestrator.start()
    orchestrator.mark_question_asked(command.question_id)
    decision = orchestrator.evaluate_answer(
        classification=assessment.classification,
        turn_ids=["turn-caca"],
        reason_codes=assessment.reason_codes,
        confidence=assessment.confidence,
        evaluation_matrix=assessment.evaluation_matrix,
    )

    assert decision.answer_evaluation.policy_action == PolicyAction.ASK_FOLLOWUP
    assert decision.commands[0].prompt_override is not None
    payload = decision.answer_evaluation.to_payload()
    assert payload["evaluation_matrix"]["challenge"]["needed"] is True


@pytest.mark.parametrize(
    (
        "name",
        "question_id",
        "transcript",
        "expected_classification",
        "expected_challenge_reason",
    ),
    [
        (
            "absurd_marker",
            "q1",
            "caca",
            AnswerClassification.VAGUE,
            "incoherent_or_absurd_answer",
        ),
        (
            "keyboard_noise",
            "q1",
            "asdf asdf asdf",
            AnswerClassification.VAGUE,
            "incoherent_or_absurd_answer",
        ),
        (
            "low_information",
            "q1",
            "Je ne sais pas trop.",
            AnswerClassification.VAGUE,
            "off_topic_or_low_relevance",
        ),
        (
            "off_topic_weather",
            "q2",
            "Il fait beau aujourd'hui et je prefere parler de football.",
            AnswerClassification.VAGUE,
            "off_topic_or_low_relevance",
        ),
        (
            "generic_claim_without_evidence",
            "q2",
            "Je suis motive et tres bon dans ce que je fais.",
            AnswerClassification.VAGUE,
            "off_topic_or_low_relevance",
        ),
        (
            "repeated_keyword_stuffing",
            "q2",
            "client client client client client",
            AnswerClassification.VAGUE,
            "answer_needs_clarification",
        ),
        (
            "contradictory_answer",
            "q2",
            "J'ai priorise la roadmap mais je n'ai jamais priorise de roadmap ni travaille avec des clients.",
            AnswerClassification.VAGUE,
            "answer_needs_clarification",
        ),
        (
            "protected_trait_without_job_signal",
            "q2",
            "J'ai 52 ans et je suis mere de famille.",
            AnswerClassification.VAGUE,
            "off_topic_or_low_relevance",
        ),
        (
            "concrete_relevant_experience",
            "q2",
            (
                "J'ai gere un incident client important: j'ai priorise le correctif, "
                "coordonne l'equipe support et mesure le resultat sur le churn."
            ),
            AnswerClassification.COMPLETE,
            None,
        ),
        (
            "valid_logistics",
            "q3",
            "Je suis disponible dans deux semaines et je peux travailler en hybride.",
            AnswerClassification.COMPLETE,
            None,
        ),
    ],
)
def test_matrix_smoke_scenarios(
    name: str,
    question_id: str,
    transcript: str,
    expected_classification: AnswerClassification,
    expected_challenge_reason: str | None,
) -> None:
    plan = three_question_plan()
    question = next(question for question in plan.questions if question.id == question_id)

    assessment = InterviewOrchestrator.assess_candidate_turn(
        plan=plan,
        question=question,
        turn=CandidateTurn(question_id=question.id, transcript=transcript),
    )

    assert assessment.classification == expected_classification, name
    assert assessment.evaluation_matrix is not None
    if expected_challenge_reason is None:
        assert assessment.evaluation_matrix.challenge_needed is False, name
        assert assessment.evaluation_matrix.overall_score >= 10, name
    else:
        assert assessment.evaluation_matrix.challenge_needed is True, name
        assert assessment.evaluation_matrix.challenge_reason == expected_challenge_reason, name


def test_rejects_answer_when_no_question_is_active() -> None:
    orchestrator = InterviewOrchestrator(three_question_plan())

    with pytest.raises(ValueError):
        orchestrator.evaluate_answer(
            classification=AnswerClassification.COMPLETE,
            turn_ids=["turn-1"],
        )
