import { generateDeterministicInterviewDraft } from "@prelude/core";
import { interviewPlanSchema, type InterviewPlan } from "@prelude/contracts";
import { describe, expect } from "vitest";
import { it } from "vitest";

import {
  createOpenAIDraftQualityEvaluator,
  defaultDraftQualityLlmModel,
  draftQualityRegressionThreshold,
} from "./draft-quality-eval";

const runLive =
  process.env.ALLOW_LIVE_LLM_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
    ? it
    : it.skip;

describe("live OpenAI draft quality judge", () => {
  runLive(
    "scores a real deterministic-generated draft above the threshold",
    async () => {
      const evaluator = createOpenAIDraftQualityEvaluator({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.DRAFT_QUALITY_LLM_MODEL ?? defaultDraftQualityLlmModel,
        timeoutMs: 30_000,
      });

      const report = await evaluator.evaluate(goodPlan());

      expect(report.available).toBe(true);
      expect(report.overallScore).toBeGreaterThanOrEqual(
        draftQualityRegressionThreshold,
      );
      expect(report.dimensions["compliance-safety"].score).toBeGreaterThanOrEqual(
        80,
      );
    },
    45_000,
  );

  runLive(
    "scores a hand-crafted bad draft below the threshold",
    async () => {
      const evaluator = createOpenAIDraftQualityEvaluator({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.DRAFT_QUALITY_LLM_MODEL ?? defaultDraftQualityLlmModel,
        timeoutMs: 30_000,
      });

      const report = await evaluator.evaluate(badPlan());

      expect(report.available).toBe(true);
      expect(report.overallScore).toBeLessThan(draftQualityRegressionThreshold);
    },
    45_000,
  );
});

function goodPlan(): InterviewPlan {
  const draft = generateDeterministicInterviewDraft({
    companyName: "Prelude",
    jobTitle: "Customer Success Manager",
    jobDescription:
      "We are hiring a Customer Success Manager to onboard SMB customers, spot early retention risks, coordinate with support and product, and communicate clearly with customers during implementation.",
    seniority: "mid",
    focus: ["role_skills", "situational_judgment", "motivation", "communication"],
  });

  return interviewPlanSchema.parse({
    roleTitle: "Customer Success Manager",
    roleBrief:
      "We are hiring a Customer Success Manager to onboard SMB customers and reduce churn risk.",
    seniority: "mid",
    focus: ["role_skills", "motivation"],
    responseModes: ["audio", "text"],
    questions: draft.questions,
    criteria: draft.criteria,
    guardrails: draft.guardrails,
    estimatedMinutes: draft.estimatedMinutes,
    rationale: draft.rationale,
  });
}

function badPlan(): InterviewPlan {
  return interviewPlanSchema.parse({
    roleTitle: "Operations Associate",
    roleBrief: "Operations support role.",
    seniority: "junior",
    focus: [],
    responseModes: ["text"],
    questions: [
      {
        id: "q1",
        prompt: "Tell us about yourself.",
        category: "custom",
        required: true,
        maxFollowups: 1,
        durationSeconds: 75,
        source: "agent",
      },
      {
        id: "q2",
        prompt: "Tell us about yourself please.",
        category: "custom",
        required: true,
        maxFollowups: 1,
        durationSeconds: 75,
        source: "agent",
      },
      {
        id: "q3",
        prompt: "What are your strengths?",
        category: "custom",
        required: true,
        maxFollowups: 1,
        durationSeconds: 75,
        source: "agent",
      },
    ],
    criteria: [
      {
        id: "c1",
        label: "General fit",
        description: "The candidate seems like a good fit overall.",
      },
    ],
    guardrails: [],
  });
}
