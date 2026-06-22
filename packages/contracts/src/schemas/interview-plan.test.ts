import { describe, expect, it } from "vitest";

import { liveInterviewPlanSchema } from "./live-interview";
import {
  INTERVIEW_PLAN_SCHEMA_VERSION,
  interviewPlanQuestionSchema,
  interviewPlanSchema,
  parseStoredInterviewPlan,
  toLiveInterviewPlan,
} from "./interview-plan";

const canonicalPlan = () => ({
  roleTitle: "Customer Success Manager",
  roleBrief:
    "We are hiring a Customer Success Manager to onboard SMB customers and reduce churn risk.",
  seniority: "mid",
  focus: ["role_skills", "motivation"],
  responseModes: ["audio", "text"],
  questions: [
    {
      id: "q1",
      prompt: "Tell us about a recent onboarding project you handled.",
      expectedSignal: "Relevant customer onboarding evidence",
      category: "experience",
      required: true,
      maxFollowups: 1,
      durationSeconds: 90,
      source: "job_description",
    },
    {
      id: "q2",
      prompt: "What made this role a strong next step for you?",
      expectedSignal: "Role motivation and clarity of expectations",
      category: "motivation",
      required: true,
      maxFollowups: 1,
      durationSeconds: 75,
      source: "agent",
    },
  ],
  criteria: [
    {
      id: "evidence",
      label: "Relevant evidence",
      description: "Examples connect to onboarding and customer outcomes.",
    },
  ],
});

describe("interviewPlanQuestionSchema", () => {
  it("applies Hybrid defaults: required true, one follow-up, agent source, custom category", () => {
    const parsed = interviewPlanQuestionSchema.parse({
      id: "q1",
      prompt: "Tell us about a recent project relevant to this role.",
    });

    expect(parsed.required).toBe(true);
    expect(parsed.maxFollowups).toBe(1);
    expect(parsed.category).toBe("custom");
    expect(parsed.source).toBe("agent");
    expect(parsed.durationSeconds).toBe(75);
  });

  it("rejects more than one follow-up per question", () => {
    const result = interviewPlanQuestionSchema.safeParse({
      id: "q1",
      prompt: "Tell us about a recent project relevant to this role.",
      maxFollowups: 2,
    });

    expect(result.success).toBe(false);
  });
});

describe("interviewPlanSchema", () => {
  it("parses a canonical persisted interview plan and stamps the schema version", () => {
    const parsed = interviewPlanSchema.parse(canonicalPlan());

    expect(parsed.schemaVersion).toBe(INTERVIEW_PLAN_SCHEMA_VERSION);
    expect(parsed.questions).toHaveLength(2);
    expect(parsed.questions[0]?.expectedSignal).toBe(
      "Relevant customer onboarding evidence",
    );
  });

  it("caps persisted questions at five", () => {
    const question = canonicalPlan().questions[0]!;
    const result = interviewPlanSchema.safeParse({
      ...canonicalPlan(),
      questions: Array.from({ length: 6 }, (_value, index) => ({
        ...question,
        id: `q${index}`,
      })),
    });

    expect(result.success).toBe(false);
  });
});

describe("parseStoredInterviewPlan (legacy upgrader)", () => {
  it("upgrades a legacy row that uses signal and lacks the new fields", () => {
    const legacyRow = {
      roleTitle: "Backend Engineer",
      roleBrief:
        "We are hiring a backend engineer to own services and debug incidents.",
      seniority: "mid",
      focus: ["motivation"],
      responseModes: ["audio", "text"],
      questions: [
        {
          id: "q1",
          prompt: "Describe a production incident you debugged end to end.",
          signal: "Problem solving",
          source: "job_description",
          durationSeconds: 75,
        },
      ],
      criteria: [
        {
          id: "c1",
          label: "Problem solving",
          description: "Looks for concrete, job-related evidence.",
        },
      ],
      guardrails: ["Ask every candidate the same questions in the same order."],
      estimatedMinutes: 15,
      rationale: "Prepared focused first-screen questions.",
    };

    const parsed = parseStoredInterviewPlan(legacyRow);
    const question = parsed.questions[0]!;

    expect(question.expectedSignal).toBe("Problem solving");
    expect(question.required).toBe(true);
    expect(question.maxFollowups).toBe(1);
    expect(question.category).not.toBeUndefined();
    expect(parsed.schemaVersion).toBe(INTERVIEW_PLAN_SCHEMA_VERSION);
  });

  it("drops a too-short or empty legacy signal to undefined instead of rejecting", () => {
    const row = {
      roleTitle: "Backend Engineer",
      roleBrief:
        "We are hiring a backend engineer to own services and debug incidents.",
      seniority: "mid",
      focus: ["motivation"],
      responseModes: ["audio"],
      questions: [
        {
          id: "q1",
          prompt: "Describe a production incident you debugged end to end.",
          signal: "",
          source: "agent",
          durationSeconds: 75,
        },
        {
          id: "q2",
          prompt: "Tell us about a system you designed under real constraints.",
          signal: "ok",
          source: "agent",
          durationSeconds: 75,
        },
      ],
      criteria: [
        {
          id: "c1",
          label: "Problem solving",
          description: "Looks for concrete, job-related evidence.",
        },
      ],
      guardrails: ["Ask every candidate the same questions in the same order."],
      estimatedMinutes: 15,
      rationale: "Prepared focused first-screen questions.",
    };

    expect(() => parseStoredInterviewPlan(row)).not.toThrow();
    const parsed = parseStoredInterviewPlan(row);
    expect(parsed.questions[0]!.expectedSignal).toBeUndefined();
    expect(parsed.questions[1]!.expectedSignal).toBeUndefined();
  });

  it("derives category from legacy source/focus when absent", () => {
    const base = {
      roleTitle: "Backend Engineer",
      roleBrief:
        "We are hiring a backend engineer to own services and debug incidents.",
      responseModes: ["audio"],
      criteria: [
        {
          id: "c1",
          label: "Problem solving",
          description: "Looks for concrete, job-related evidence.",
        },
      ],
    };

    const motivation = parseStoredInterviewPlan({
      ...base,
      focus: ["motivation"],
      questions: [
        {
          id: "q1",
          prompt: "What made this role a strong next step for you?",
          signal: "Motivation",
          source: "agent",
        },
      ],
    });
    expect(motivation.questions[0]?.category).toBe("motivation");

    const fromJobDescription = parseStoredInterviewPlan({
      ...base,
      focus: [],
      questions: [
        {
          id: "q1",
          prompt: "Tell us about relevant experience for this role.",
          signal: "Experience",
          source: "job_description",
        },
      ],
    });
    expect(fromJobDescription.questions[0]?.category).toBe("experience");

    const fromAttachment = parseStoredInterviewPlan({
      ...base,
      focus: [],
      questions: [
        {
          id: "q1",
          prompt: "Based on the attachment, what feels most familiar to you?",
          signal: "Attachment context",
          source: "attachment",
        },
      ],
    });
    expect(fromAttachment.questions[0]?.category).toBe("skills");
  });

  it("does not throw on a previously-valid canonical row", () => {
    expect(() => parseStoredInterviewPlan(canonicalPlan())).not.toThrow();
  });
});

describe("toLiveInterviewPlan (live handoff mapper)", () => {
  it("round-trips a canonical plan through the real liveInterviewPlanSchema", () => {
    const plan = interviewPlanSchema.parse(canonicalPlan());

    const live = toLiveInterviewPlan({
      plan,
      planId: "plan_01",
      jobId: "job_01",
    });

    // Must already be valid against the authoritative live schema.
    expect(liveInterviewPlanSchema.safeParse(live).success).toBe(true);
    expect(live.questions[0]?.expectedSignal).toBe(
      "Relevant customer onboarding evidence",
    );
    expect(live.questions[0]?.required).toBe(true);
    expect(live.questions[0]?.maxFollowups).toBe(1);
  });

  it("maps text response mode to the live form mode and defaults to audio", () => {
    const planWithText = interviewPlanSchema.parse({
      ...canonicalPlan(),
      responseModes: ["text"],
    });
    const live = toLiveInterviewPlan({
      plan: planWithText,
      planId: "plan_01",
      jobId: "job_01",
    });
    expect(live.candidateModes).toContain("form");

    const planWithoutModes = interviewPlanSchema.parse({
      ...canonicalPlan(),
      responseModes: [],
    });
    const liveDefault = toLiveInterviewPlan({
      plan: planWithoutModes,
      planId: "plan_01",
      jobId: "job_01",
    });
    expect(liveDefault.candidateModes).toEqual(["audio"]);
  });
});
