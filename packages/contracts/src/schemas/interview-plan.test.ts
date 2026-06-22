import { describe, expect, it } from "vitest";

import { liveInterviewPlanSchema } from "./live-interview";
import {
  INTERVIEW_PLAN_SCHEMA_VERSION,
  interviewPlanQuestionSchema,
  interviewPlanSchema,
  interviewQuestionSourceSchema,
  interviewResponseModeSchema,
  parseStoredInterviewPlan,
  toLiveInterviewPlan,
} from "./interview-plan";
import { liveInterviewQuestionCategorySchema } from "./live-interview";

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

  it("drops a legacy 'video' response mode instead of rejecting the row", () => {
    const legacyVideoRow = {
      ...canonicalPlan(),
      responseModes: ["audio", "video", "text"],
    };

    expect(() => parseStoredInterviewPlan(legacyVideoRow)).not.toThrow();
    const parsed = parseStoredInterviewPlan(legacyVideoRow);
    expect(parsed.responseModes).toEqual(["audio", "text"]);
    expect(parsed.responseModes).not.toContain("video");
  });
});

describe("interviewResponseModeSchema (video dropped)", () => {
  it("accepts audio and text but rejects the dropped video mode", () => {
    expect(interviewResponseModeSchema.safeParse("audio").success).toBe(true);
    expect(interviewResponseModeSchema.safeParse("text").success).toBe(true);
    expect(interviewResponseModeSchema.safeParse("video").success).toBe(false);
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

// N10.D — contract invariants. parseStoredInterviewPlan must never throw on a
// representative spread of legacy persisted rows, and whatever it produces must
// always map cleanly onto the real live interview plan schema.
describe("N10 parseStoredInterviewPlan never throws on legacy rows", () => {
  const baseRow = {
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
    guardrails: ["Ask every candidate the same questions in the same order."],
    estimatedMinutes: 15,
    rationale: "Prepared focused first-screen questions.",
  };

  const legacyRows: Array<[string, Record<string, unknown>]> = [
    [
      "signal-only question with no new fields",
      {
        ...baseRow,
        focus: ["motivation"],
        questions: [
          {
            id: "q1",
            prompt: "What made this role a strong next step for you?",
            signal: "Role motivation and clarity of expectations",
            source: "agent",
          },
        ],
      },
    ],
    [
      "empty signal that must drop to undefined",
      {
        ...baseRow,
        focus: ["role_skills"],
        questions: [
          {
            id: "q1",
            prompt: "Describe a production incident you debugged end to end.",
            signal: "",
            source: "job_description",
          },
        ],
      },
    ],
    [
      "too-short signal that must drop to undefined",
      {
        ...baseRow,
        focus: [],
        questions: [
          {
            id: "q1",
            prompt: "Tell us about a system you designed under real constraints.",
            signal: "ok",
            source: "agent",
          },
        ],
      },
    ],
    [
      "missing required/maxFollowups/category/durationSeconds",
      {
        ...baseRow,
        focus: ["role_skills"],
        questions: [
          {
            id: "q1",
            prompt: "Walk me through a recent project relevant to this role.",
            source: "job_description",
          },
        ],
      },
    ],
    [
      "missing focus and missing seniority entirely",
      {
        ...baseRow,
        questions: [
          {
            id: "q1",
            prompt: "Walk me through a recent project relevant to this role.",
            expectedSignal: "Relevant evidence",
          },
        ],
      },
    ],
    [
      "missing schemaVersion (legacy pre-N7 row)",
      {
        ...baseRow,
        focus: ["motivation"],
        questions: [
          {
            id: "q1",
            prompt: "What made this role a strong next step for you?",
            expectedSignal: "Role motivation",
            source: "agent",
          },
        ],
      },
    ],
  ];

  it.each(legacyRows)("does not throw on a %s", (_label, row) => {
    expect(() => parseStoredInterviewPlan(row)).not.toThrow();
  });

  it("always produces output that maps onto the live interview plan schema", () => {
    for (const [, row] of legacyRows) {
      const plan = parseStoredInterviewPlan(row);
      const live = toLiveInterviewPlan({
        plan,
        planId: "plan_legacy",
        jobId: "job_legacy",
      });
      expect(liveInterviewPlanSchema.safeParse(live).success).toBe(true);
    }
  });

  it("always stamps the current schema version on a legacy row", () => {
    for (const [, row] of legacyRows) {
      expect(parseStoredInterviewPlan(row).schemaVersion).toBe(
        INTERVIEW_PLAN_SCHEMA_VERSION,
      );
    }
  });
});

// N10.D — the canonical plan-question category enum must stay in lockstep with
// the live interview question category enum, since toLiveInterviewPlan copies the
// category straight across. A drift would silently break the live handoff.
describe("N10 question category enum stays in lockstep with the live schema", () => {
  it("plan category options equal the live category options", () => {
    const liveCategories = [...liveInterviewQuestionCategorySchema.options].sort();
    // interviewPlanQuestionSchema.category defaults to liveInterviewQuestionCategorySchema.
    const planQuestion = interviewPlanQuestionSchema.parse({
      id: "q1",
      prompt: "Tell us about a recent project relevant to this role.",
    });
    // Every live category must be an accepted plan category.
    for (const category of liveInterviewQuestionCategorySchema.options) {
      expect(
        interviewPlanQuestionSchema.safeParse({
          id: "q1",
          prompt: "Tell us about a recent project relevant to this role.",
          category,
        }).success,
      ).toBe(true);
    }
    expect(planQuestion.category).toBe("custom");
    expect(liveCategories).toEqual(
      ["availability", "compensation", "custom", "experience", "logistics", "motivation", "skills"].sort(),
    );
  });

  it("exposes the source enum used by the stored draft contract", () => {
    expect([...interviewQuestionSourceSchema.options].sort()).toEqual(
      ["agent", "attachment", "job_description"].sort(),
    );
  });
});
