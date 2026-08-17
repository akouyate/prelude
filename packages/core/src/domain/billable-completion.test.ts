import { describe, expect, it } from "vitest";

import { evaluateBillableCompletion } from "./billable-completion";

const answered = { completionReason: "answered" };
const skipped = { completionReason: "skipped" };

describe("evaluateBillableCompletion", () => {
  it("bills when at least half the planned questions were answered, above the floor", () => {
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 6,
        outcomes: [answered, answered, answered, skipped, skipped, skipped],
      }),
    ).toEqual({ billable: true, answeredCount: 3, requiredCount: 3 });
  });

  it("never bills below the three-answer floor, even when half the plan was met", () => {
    // This is the case the floor exists for: 4 planned / 2 answered clears the old
    // 50% rule (ceil(4*0.5)=2) but must not clear the new floor.
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 4,
        outcomes: [answered, answered, skipped, skipped],
      }),
    ).toEqual({ billable: false, answeredCount: 2, requiredCount: 3 });
  });

  it("never bills a plan shorter than the floor, however many of its questions were answered", () => {
    // A 2-question plan can never reach 3 answered questions: this is the
    // "jamais de facture sous 3 réponses, même sur trame courte" rule, not a
    // rounding artifact — the floor is not capped at plannedQuestionCount.
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 2,
        outcomes: [answered, answered],
      }),
    ).toEqual({ billable: false, answeredCount: 2, requiredCount: 3 });
  });

  it("bills exactly at the floor: three planned, three answered", () => {
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 3,
        outcomes: [answered, answered, answered],
      }),
    ).toEqual({ billable: true, answeredCount: 3, requiredCount: 3 });
  });

  it("does not bill one short of the floor: three planned, two answered", () => {
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 3,
        outcomes: [answered, answered, skipped],
      }),
    ).toEqual({ billable: false, answeredCount: 2, requiredCount: 3 });
  });

  it("bills when the floor and the ratio coincide: five planned, three answered", () => {
    // ceil(5 * 0.5) = 3, which is also the floor — the two rules agree here.
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 5,
        outcomes: [answered, answered, answered, skipped, skipped],
      }),
    ).toEqual({ billable: true, answeredCount: 3, requiredCount: 3 });
  });

  it("rounds the threshold up on odd plans, still above the floor", () => {
    const result = evaluateBillableCompletion({
      plannedQuestionCount: 5,
      outcomes: [answered, answered, skipped],
    });
    expect(result).toEqual({ billable: false, answeredCount: 2, requiredCount: 3 });
  });

  it("counts only answered outcomes, never skips or silence", () => {
    const result = evaluateBillableCompletion({
      plannedQuestionCount: 2,
      outcomes: [skipped, { completionReason: "candidate_silent" }, { completionReason: "timeboxed" }],
    });
    expect(result.billable).toBe(false);
  });

  it("never bills an empty or zero-question plan", () => {
    expect(evaluateBillableCompletion({ plannedQuestionCount: 0, outcomes: [] })).toEqual({
      billable: false,
      answeredCount: 0,
      requiredCount: 0,
    });
  });

  it("honors an explicit thresholdRatio override", () => {
    const result = evaluateBillableCompletion({
      plannedQuestionCount: 4,
      outcomes: [answered, answered, skipped, skipped],
      thresholdRatio: 1,
    });
    expect(result).toEqual({ billable: false, answeredCount: 2, requiredCount: 4 });
  });

  it("treats a zero thresholdRatio as a real override, not a missing one", () => {
    // `??` is load-bearing here, not `||`: with `thresholdRatio: 0` and 8 planned
    // questions, `??` correctly keeps the override (ceil(8*0)=0 -> floored to 3,
    // billable at 3 answered), while a buggy `||` would fall back to the default
    // 0.5 ratio (ceil(8*0.5)=4, not billable at 3 answered) — the two diverge only
    // once the plan is large enough that the default ratio's requirement exceeds
    // the floor.
    const result = evaluateBillableCompletion({
      plannedQuestionCount: 8,
      outcomes: [answered, answered, answered, skipped, skipped, skipped, skipped, skipped],
      thresholdRatio: 0,
    });
    expect(result).toEqual({ billable: true, answeredCount: 3, requiredCount: 3 });
  });
});
