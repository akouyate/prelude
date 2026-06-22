import { generateDeterministicInterviewDraft } from "@prelude/core";
import { interviewPlanSchema, type InterviewPlan } from "@prelude/contracts";
import { describe, expect, it } from "vitest";

import {
  createDeterministicDraftQualityEvaluator,
  createDraftQualityEvaluatorFromEnv,
  createOpenAIDraftQualityEvaluator,
  draftQualityDimensions,
  draftQualityRegressionThreshold,
  type DraftQualityReport,
} from "./draft-quality-eval";

describe("draft quality evaluator provider selection", () => {
  it("uses the deterministic grader when explicitly configured", () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      DRAFT_QUALITY_EVALUATOR: "deterministic",
      OPENAI_API_KEY: "sk-test",
    });

    expect(evaluator.provider).toBe("deterministic");
  });

  it("uses the deterministic grader under NODE_ENV=test even with a key", () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test",
    });

    expect(evaluator.provider).toBe("deterministic");
  });

  it("returns a disabled evaluator when turned off", () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      DRAFT_QUALITY_EVALUATOR: "off",
    });

    expect(evaluator.provider).toBe("disabled");
  });

  it("degrades to deterministic for an unknown provider", () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      DRAFT_QUALITY_EVALUATOR: "anthropic",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    });

    expect(evaluator.provider).toBe("deterministic");
  });

  it("degrades to deterministic when the key is missing", () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      DRAFT_QUALITY_EVALUATOR: "openai",
      NODE_ENV: "production",
    });

    expect(evaluator.provider).toBe("deterministic");
  });

  it("selects the OpenAI judge when configured with a key", () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      DRAFT_QUALITY_EVALUATOR: "openai",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    });

    expect(evaluator.provider).toBe("openai_judge");
  });
});

describe("deterministic draft quality grader", () => {
  it("scores a real generated draft above the regression threshold", async () => {
    const evaluator = createDeterministicDraftQualityEvaluator();
    const report = await evaluator.evaluate(goodPlan());

    expect(report.overallScore).toBeGreaterThanOrEqual(
      draftQualityRegressionThreshold,
    );
    expect(report.passed).toBe(true);
    expect(report.issues).toHaveLength(0);
    for (const dimension of draftQualityDimensions) {
      expect(report.dimensions[dimension].score).toBeGreaterThanOrEqual(60);
    }
  });

  it("is deterministic and reproducible for the same plan", async () => {
    const evaluator = createDeterministicDraftQualityEvaluator();
    const plan = goodPlan();
    const first = await evaluator.evaluate(plan);
    const second = await evaluator.evaluate(plan);

    expect(first.overallScore).toBe(second.overallScore);
    expect(first.dimensions).toEqual(second.dimensions);
  });

  it("scores a low-quality redundant draft below the threshold", async () => {
    const evaluator = createDeterministicDraftQualityEvaluator();
    const report = await evaluator.evaluate(badPlan());

    expect(report.overallScore).toBeLessThan(draftQualityRegressionThreshold);
    expect(report.passed).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.dimensions["non-redundancy"].score).toBeLessThan(60);
    expect(report.dimensions["signal-clarity"].score).toBeLessThan(60);
  });

  it("hard-fails the compliance dimension for a protected-topic question", async () => {
    const evaluator = createDeterministicDraftQualityEvaluator();
    const report = await evaluator.evaluate(protectedTopicPlan());

    expect(report.dimensions["compliance-safety"].score).toBe(0);
    expect(report.passed).toBe(false);
    expect(
      report.issues.some((issue) => issue.dimension === "compliance-safety"),
    ).toBe(true);
  });

  it("hard-fails compliance when a criterion violates policy", async () => {
    const evaluator = createDeterministicDraftQualityEvaluator();
    const report = await evaluator.evaluate(protectedCriterionPlan());

    expect(report.dimensions["compliance-safety"].score).toBe(0);
    expect(report.passed).toBe(false);
  });
});

describe("disabled draft quality grader", () => {
  it("returns a neutral unavailable report without grading", async () => {
    const evaluator = createDraftQualityEvaluatorFromEnv({
      DRAFT_QUALITY_EVALUATOR: "off",
    });

    const report = await evaluator.evaluate(goodPlan());

    expect(report.available).toBe(false);
    expect(report.provider).toBe("disabled");
  });
});

describe("openai draft quality judge", () => {
  it("parses a canned judge response without a network request", async () => {
    const calls: Array<{ body: string }> = [];
    const evaluator = createOpenAIDraftQualityEvaluator({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push({ body: init.body });
        return jsonResponse({
          output_text: JSON.stringify(cannedJudgePayload()),
        });
      },
      model: "gpt-4.1-mini",
      timeoutMs: 5_000,
    });

    const report = await evaluator.evaluate(goodPlan());

    expect(calls).toHaveLength(1);
    expect(report.available).toBe(true);
    expect(report.provider).toBe("openai_judge");
    expect(report.overallScore).toBe(84);
    expect(report.dimensions["job-relatedness"].score).toBe(90);
    expect(report.dimensions["job-relatedness"].rationale).toContain(
      "tied to the role",
    );
  });

  it("still hard-fails compliance locally even if the judge passes it", async () => {
    const evaluator = createOpenAIDraftQualityEvaluator({
      apiKey: "sk-test",
      fetcher: async () =>
        jsonResponse({
          output_text: JSON.stringify(cannedJudgePayload()),
        }),
      model: "gpt-4.1-mini",
      timeoutMs: 5_000,
    });

    const report = await evaluator.evaluate(protectedTopicPlan());

    expect(report.dimensions["compliance-safety"].score).toBe(0);
    expect(report.passed).toBe(false);
  });

  it("fails soft to an unavailable report on a network error", async () => {
    const evaluator = createOpenAIDraftQualityEvaluator({
      apiKey: "sk-test",
      fetcher: async () => {
        throw new Error("network down");
      },
      model: "gpt-4.1-mini",
      timeoutMs: 5_000,
    });

    const report = await evaluator.evaluate(goodPlan());

    expect(report.available).toBe(false);
    expect(report.provider).toBe("openai_judge");
    expect(report.overallScore).toBe(0);
  });

  it("fails soft to an unavailable report on an HTTP error", async () => {
    const evaluator = createOpenAIDraftQualityEvaluator({
      apiKey: "sk-test",
      fetcher: async () => jsonResponse({}, { ok: false, status: 500 }),
      model: "gpt-4.1-mini",
      timeoutMs: 5_000,
    });

    const report = await evaluator.evaluate(goodPlan());

    expect(report.available).toBe(false);
  });

  it("fails soft when the judge payload is malformed", async () => {
    const evaluator = createOpenAIDraftQualityEvaluator({
      apiKey: "sk-test",
      fetcher: async () =>
        jsonResponse({ output_text: "not json at all" }),
      model: "gpt-4.1-mini",
      timeoutMs: 5_000,
    });

    const report = await evaluator.evaluate(goodPlan());

    expect(report.available).toBe(false);
  });
});

function jsonResponse(
  payload: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  return {
    json: async () => payload,
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function cannedJudgePayload() {
  return {
    overallScore: 84,
    dimensions: [
      {
        dimension: "job-relatedness",
        score: 90,
        rationale: "Every question is tied to the role responsibilities.",
      },
      {
        dimension: "behavioral-anchoring",
        score: 82,
        rationale: "Questions invite concrete past situations.",
      },
      {
        dimension: "signal-clarity",
        score: 80,
        rationale: "Each question states what a strong answer reveals.",
      },
      {
        dimension: "non-redundancy",
        score: 88,
        rationale: "Questions cover distinct competencies.",
      },
      {
        dimension: "compliance-safety",
        score: 100,
        rationale: "No protected attributes are probed.",
      },
    ],
    issues: ["Consider one more situational-judgment prompt."],
  };
}

function planFromDeterministicDraft(): InterviewPlan {
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
    questions: draft.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      expectedSignal: question.expectedSignal,
      category: question.category,
      required: question.required,
      maxFollowups: question.maxFollowups,
      durationSeconds: question.durationSeconds,
      source: question.source,
    })),
    criteria: draft.criteria,
    guardrails: draft.guardrails,
    estimatedMinutes: draft.estimatedMinutes,
    rationale: draft.rationale,
  });
}

function goodPlan(): InterviewPlan {
  return planFromDeterministicDraft();
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

function protectedTopicPlan(): InterviewPlan {
  return interviewPlanSchema.parse({
    roleTitle: "Operations Associate",
    roleBrief: "Operations support role.",
    seniority: "mid",
    focus: ["role_skills"],
    responseModes: ["audio"],
    questions: [
      {
        id: "q1",
        prompt:
          "Tell us about a recent operations project and what made it successful.",
        expectedSignal: "Relevant operations evidence and follow-through",
        category: "experience",
        required: true,
        maxFollowups: 1,
        durationSeconds: 90,
        source: "job_description",
      },
      {
        id: "q2",
        prompt: "How old are you, and do you have any children at home?",
        expectedSignal: "Personal availability context",
        category: "custom",
        required: true,
        maxFollowups: 1,
        durationSeconds: 75,
        source: "agent",
      },
      {
        id: "q3",
        prompt:
          "Describe how you would coordinate a delayed shipment across teams.",
        expectedSignal: "Cross-team coordination and exception handling",
        category: "experience",
        required: true,
        maxFollowups: 1,
        durationSeconds: 90,
        source: "job_description",
      },
    ],
    criteria: [
      {
        id: "c1",
        label: "Operational judgment",
        description:
          "Evidence shows clear exception handling and coordination across teams.",
      },
    ],
    guardrails: [],
  });
}

function protectedCriterionPlan(): InterviewPlan {
  const plan = planFromDeterministicDraft();

  return interviewPlanSchema.parse({
    ...plan,
    criteria: [
      ...plan.criteria.slice(0, 1),
      {
        id: "biased",
        label: "Cultural fit",
        description:
          "Reviewer should consider whether the candidate is pregnant or planning a family.",
      },
    ],
  });
}
