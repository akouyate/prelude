import { describe, expect, it } from "vitest";

import {
  generateDeterministicInterviewDraft,
  resolveTargetInterviewQuestionCount,
} from "./interview-agent";

describe("interview agent draft policy", () => {
  it("keeps simple junior roles to 3 questions", () => {
    expect(
      resolveTargetInterviewQuestionCount({
        focus: ["role_skills", "motivation"],
        jobDescription: "Prepare orders, keep the workspace clean, and follow team routines.",
        jobTitle: "Kitchen Assistant",
        seniority: "junior",
      }),
    ).toBe(3);
  });

  it("uses 4 questions for customer-facing or operationally complex roles", () => {
    expect(
      resolveTargetInterviewQuestionCount({
        focus: ["role_skills", "situational_judgment", "motivation"],
        jobDescription:
          "Own customer onboarding, coordinate support and product stakeholders, and reduce churn risk for SMB customers.",
        jobTitle: "Customer Success Manager",
        seniority: "mid",
      }),
    ).toBe(4);
  });

  it("caps senior complex roles at 5 questions", () => {
    expect(
      resolveTargetInterviewQuestionCount({
        focus: [
          "role_skills",
          "situational_judgment",
          "motivation",
          "communication",
        ],
        jobDescription:
          "Lead cross-functional enterprise strategy with managers, customers, ambiguous priorities, travel, hybrid collaboration, ownership, and stakeholder alignment.".repeat(
            5,
          ),
        jobTitle: "Senior Operations Lead",
        seniority: "senior",
      }),
    ).toBe(5);
  });

  it("generates a publishable first-screen draft with the target question count", () => {
    const draft = generateDeterministicInterviewDraft({
      companyName: "Prelude",
      focus: [
        "role_skills",
        "situational_judgment",
        "motivation",
        "communication",
      ],
      jobDescription:
        "Hire a senior customer operations lead to own onboarding, manage stakeholders, and improve support workflows.",
      jobTitle: "Senior Customer Operations Lead",
      seniority: "senior",
    });

    expect(draft.questions).toHaveLength(5);
    expect(draft.criteria.length).toBeGreaterThanOrEqual(4);
    expect(draft.guardrails.join(" ")).toContain(
      "Ask every candidate the same questions",
    );
    expect(draft.rationale).toContain("Prelude generated 5 focused questions");

    for (const question of draft.questions) {
      expect(question.expectedSignal.length).toBeGreaterThan(0);
      expect(question.required).toBe(true);
      expect(question.maxFollowups).toBe(1);
      expect([
        "motivation",
        "experience",
        "skills",
        "logistics",
        "availability",
        "compensation",
        "custom",
      ]).toContain(question.category);
    }
  });

  it("emits the Hybrid question shape from the question library focus mapping", () => {
    const draft = generateDeterministicInterviewDraft({
      companyName: "Prelude",
      focus: ["motivation", "role_skills", "situational_judgment", "communication"],
      jobDescription:
        "Hire a mid-level customer success manager to own onboarding and reduce churn risk.",
      jobTitle: "Customer Success Manager",
      seniority: "mid",
    });

    const motivation = draft.questions.find((q) => q.id === "motivation");
    expect(motivation?.category).toBe("motivation");
    expect(motivation?.expectedSignal).toBe(
      "Role motivation and clarity of expectations",
    );
    expect(motivation?.required).toBe(true);
    expect(motivation?.maxFollowups).toBe(1);
  });

  it.each([
    {
      expectedSignals: ["marketing", "budget"],
      jobDescription:
        "Own growth strategy, brand positioning, demand generation, pipeline, revenue partnership, market insight, and executive stakeholder alignment.",
      jobTitle: "CMO",
      seniority: "senior" as const,
    },
    {
      expectedSignals: ["supplier", "risk"],
      jobDescription:
        "Manage procurement, supplier sourcing, category planning, vendor performance, cost tradeoffs, delivery risk, and contract coordination.",
      jobTitle: "Buyer",
      seniority: "mid" as const,
    },
    {
      expectedSignals: ["hiring", "fairness"],
      jobDescription:
        "Run recruiting intake, sourcing, structured screening, candidate follow-up, hiring manager calibration, ATS reporting, and fair hiring practices.",
      jobTitle: "HR Manager",
      seniority: "mid" as const,
    },
    {
      expectedSignals: ["ai", "workflow"],
      jobDescription:
        "Design AI workflow orchestration, prompt systems, tool use, human-in-the-loop review, evaluation, privacy safeguards, and production failure handling.",
      jobTitle: "AI Orchestrator",
      seniority: "senior" as const,
    },
    {
      expectedSignals: ["guest", "shift"],
      jobDescription:
        "Manage restaurant hospitality operations, guest recovery, shift planning, service standards, team coordination, inventory discipline, and pressure during peak periods.",
      jobTitle: "Restaurant Manager",
      seniority: "mid" as const,
    },
    {
      expectedSignals: ["delivery", "carrier"],
      jobDescription:
        "Coordinate logistics, shipment tracking, carrier follow-up, warehouse handoffs, documentation accuracy, exception handling, and operational updates.",
      jobTitle: "Logistics Coordinator",
      seniority: "mid" as const,
    },
  ])(
    "generates role-specific first-screen questions for $jobTitle",
    ({ expectedSignals, jobDescription, jobTitle, seniority }) => {
      const draft = generateDeterministicInterviewDraft({
        companyName: "Prelude",
        focus: [
          "role_skills",
          "situational_judgment",
          "motivation",
          "communication",
        ],
        jobDescription,
        jobTitle,
        seniority,
      });
      const content = draft.questions
        .map((question) => `${question.prompt} ${question.expectedSignal}`)
        .join(" ")
        .toLowerCase();
      const genericQuestionIds = [
        "communication",
        "motivation",
        "recruiter-context",
        "role-skills",
        "situational-judgment",
      ];
      const roleSpecificQuestions = draft.questions.filter(
        (question) => !genericQuestionIds.includes(question.id),
      );

      expect(draft.questions.length).toBeGreaterThanOrEqual(4);
      expect(draft.questions.length).toBeLessThanOrEqual(5);
      expect(roleSpecificQuestions.length).toBeGreaterThanOrEqual(3);
      for (const signal of expectedSignals) {
        expect(content).toContain(signal);
      }
      expect(content).not.toMatch(
        /\b(age|children|married|pregnant|religion|national origin)\b/u,
      );
    },
  );
});
