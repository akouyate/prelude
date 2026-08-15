// The billing event from #139: an interview is billable when at least half the
// planned questions were actually answered, judged from the append-only live
// event store. Pure so the rule can be replayed over historical sessions to
// validate the ratio before launch.
export const BILLABLE_THRESHOLD_RATIO = 0.5;

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
  const requiredCount = Math.max(1, Math.ceil(input.plannedQuestionCount * ratio));
  return { billable: answeredCount >= requiredCount, answeredCount, requiredCount };
}
