import pytest

from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.orchestrator import (
    AnswerClassification,
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
            InterviewQuestion(id="q1", prompt="Why are you interested?"),
            InterviewQuestion(
                id="q2",
                prompt="Tell me about a customer situation.",
                follow_up_prompt="What did you do next?",
            ),
            InterviewQuestion(id="q3", prompt="What are your availabilities?"),
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


def test_rejects_answer_when_no_question_is_active() -> None:
    orchestrator = InterviewOrchestrator(three_question_plan())

    with pytest.raises(ValueError):
        orchestrator.evaluate_answer(
            classification=AnswerClassification.COMPLETE,
            turn_ids=["turn-1"],
        )
