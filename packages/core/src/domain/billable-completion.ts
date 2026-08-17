// The billing event from #139: an interview is billable when at least half the
// planned questions were actually answered, judged from the append-only live
// event store. Pure so the rule can be replayed over historical sessions to
// validate the ratio before launch.
export const BILLABLE_THRESHOLD_RATIO = 0.5;

// Product rule (2026-08-15): a brief built on fewer than three answers is not
// worth charging for, whatever the plan length. This is a hard floor, not a
// rounding artifact of the ratio above — it also removes the incentive to draft
// a deliberately short plan to make the 50% rule easier to clear. A plan of one
// or two questions can therefore never bill, and a three-question plan requires
// every question answered.
export const BILLABLE_MINIMUM_ANSWERS = 3;

export type QuestionOutcome = { completionReason: string };

export function evaluateBillableCompletion(input: {
  plannedQuestionCount: number;
  outcomes: QuestionOutcome[];
  thresholdRatio?: number;
}): { billable: boolean; answeredCount: number; requiredCount: number } {
  const ratio = input.thresholdRatio ?? BILLABLE_THRESHOLD_RATIO;
  if (input.plannedQuestionCount <= 0) {
    return { billable: false, answeredCount: 0, requiredCount: 0 };
  }
  const answeredCount = input.outcomes.filter(
    (outcome) => outcome.completionReason === "answered",
  ).length;
  const requiredCount = Math.max(
    BILLABLE_MINIMUM_ANSWERS,
    Math.ceil(input.plannedQuestionCount * ratio),
  );
  return { billable: answeredCount >= requiredCount, answeredCount, requiredCount };
}
