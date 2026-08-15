import { describe, expect, it } from "vitest";

import { evaluateBillableCompletion } from "./billable-completion";

const answered = { completionReason: "answered" };
const skipped = { completionReason: "skipped" };

describe("evaluateBillableCompletion", () => {
  it("bills when at least half the planned questions were answered", () => {
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 4,
        outcomes: [answered, answered, skipped, skipped],
      }),
    ).toEqual({ billable: true, answeredCount: 2, requiredCount: 2 });
  });

  it("rounds the threshold up on odd plans", () => {
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
});
