import {
  generateDeterministicInterviewDraft,
  type InterviewDraftInput,
} from "@prelude/core";
import { interviewPlanSchema, type InterviewPlan } from "@prelude/contracts";
import { describe, expect, it } from "vitest";

import {
  createDeterministicDraftQualityEvaluator,
  draftQualityDimensions,
  draftQualityRegressionThreshold,
} from "./draft-quality-eval";

// N11 regression harness. Grades the deterministic generator's output for
// several role archetypes with the deterministic quality grader (no paid LLM
// calls) and asserts the score stays above the regression threshold. A future
// generator or prompt change that tanks quality fails CI deterministically.
const archetypes: Array<{ name: string; input: InterviewDraftInput }> = [
  {
    name: "Customer Success Manager",
    input: {
      companyName: "Prelude",
      jobTitle: "Customer Success Manager",
      jobDescription:
        "Onboard SMB customers, spot early retention risks, coordinate with support and product, and communicate clearly during implementation.",
      seniority: "mid",
      focus: [
        "role_skills",
        "situational_judgment",
        "motivation",
        "communication",
      ],
    },
  },
  {
    name: "Chief Marketing Officer",
    input: {
      companyName: "Prelude",
      jobTitle: "Chief Marketing Officer",
      jobDescription:
        "Own brand, demand generation, and growth strategy across the enterprise. Lead cross-functional alignment with sales and product on pipeline and revenue.",
      seniority: "senior",
      focus: ["role_skills", "situational_judgment", "communication"],
    },
  },
  {
    name: "Procurement Buyer",
    input: {
      companyName: "Prelude",
      jobTitle: "Procurement Buyer",
      jobDescription:
        "Manage suppliers and category strategy, balancing cost, quality, risk, and delivery for a growing operations team.",
      seniority: "mid",
      focus: ["role_skills", "situational_judgment"],
    },
  },
  {
    name: "HR Manager",
    input: {
      companyName: "Prelude",
      jobTitle: "HR Manager",
      jobDescription:
        "Lead talent acquisition and people operations, partnering with hiring managers on structured, fair, job-related screening.",
      seniority: "senior",
      focus: ["role_skills", "situational_judgment", "communication"],
    },
  },
  {
    name: "Logistics Coordinator",
    input: {
      companyName: "Prelude",
      jobTitle: "Logistics Coordinator",
      jobDescription:
        "Coordinate shipments, carriers, and warehouse exceptions for a hybrid operations team handling time-sensitive deliveries.",
      seniority: "junior",
      focus: ["role_skills", "communication"],
    },
  },
];

describe("deterministic generator quality regression", () => {
  const evaluator = createDeterministicDraftQualityEvaluator();

  for (const archetype of archetypes) {
    it(`keeps ${archetype.name} drafts above the regression threshold`, async () => {
      const plan = planFromDraft(archetype.input);
      const report = await evaluator.evaluate(plan);

      expect(
        report.overallScore,
        `${archetype.name} scored ${report.overallScore} (${report.issues
          .map((issue) => issue.message)
          .join("; ")})`,
      ).toBeGreaterThanOrEqual(draftQualityRegressionThreshold);
      expect(report.passed).toBe(true);
      expect(report.dimensions["compliance-safety"].score).toBe(100);
    });
  }

  it("never produces a dimension below the minimum on a healthy archetype", async () => {
    const plan = planFromDraft(archetypes[0]!.input);
    const report = await evaluator.evaluate(plan);

    for (const dimension of draftQualityDimensions) {
      expect(
        report.dimensions[dimension].score,
        `${dimension} regressed to ${report.dimensions[dimension].score}`,
      ).toBeGreaterThanOrEqual(60);
    }
  });
});

function planFromDraft(input: InterviewDraftInput): InterviewPlan {
  const draft = generateDeterministicInterviewDraft(input);

  return interviewPlanSchema.parse({
    roleTitle: input.jobTitle,
    roleBrief: input.jobDescription,
    seniority: input.seniority,
    focus: ["role_skills", "motivation"],
    responseModes: ["audio", "text"],
    questions: draft.questions,
    criteria: draft.criteria,
    guardrails: draft.guardrails,
    estimatedMinutes: draft.estimatedMinutes,
    rationale: draft.rationale,
  });
}
