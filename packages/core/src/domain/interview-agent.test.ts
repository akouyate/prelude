import { describe, expect, it } from "vitest";

import { textViolatesPolicy } from "../policies/ai";
import {
  generateDeterministicInterviewDraft,
  type InterviewFocus,
  type InterviewSeniority,
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

// N10.A — deterministic generator invariants. These lock the count tiers, caps,
// default-focus fallback, estimatedMinutes computation, and the Hybrid question
// shape so a regression in the generator surfaces in CI rather than in a draft.
describe("N10 deterministic generator invariants", () => {
  const allFocus: InterviewFocus[] = [
    "role_skills",
    "situational_judgment",
    "motivation",
    "communication",
  ];

  const complexInput = () => ({
    companyName: "Prelude",
    focus: allFocus,
    jobDescription:
      "Lead cross-functional enterprise strategy with managers, customers, ambiguous priorities, travel, hybrid collaboration, ownership, and stakeholder alignment.".repeat(
        5,
      ),
    jobTitle: "Senior Operations Lead",
    seniority: "senior" as const,
  });

  it("caps questions at 5 and criteria at 5 even for the most complex role", () => {
    const draft = generateDeterministicInterviewDraft(complexInput());

    expect(draft.questions.length).toBeLessThanOrEqual(5);
    expect(draft.criteria.length).toBeLessThanOrEqual(5);
    // The most complex role should actually reach the 5-question tier.
    expect(draft.questions).toHaveLength(5);
  });

  it("selects the 3/4/5 question-count tier by focus + seniority + complexity", () => {
    // Tier 3: simple junior role, no complexity signals.
    expect(
      resolveTargetInterviewQuestionCount({
        focus: ["role_skills", "motivation"],
        jobDescription: "Prepare orders and keep the workspace clean.",
        jobTitle: "Kitchen Assistant",
        seniority: "junior",
      }),
    ).toBe(3);

    // Tier 4: a single complexity signal (here, 4+ focus areas) lifts it to 4.
    expect(
      resolveTargetInterviewQuestionCount({
        focus: allFocus,
        jobDescription: "Coordinate a small team and keep work moving.",
        jobTitle: "Team Lead",
        seniority: "mid",
      }),
    ).toBe(4);

    // Tier 5: three+ complexity signals (senior + 4 focus + long, keyword-rich
    // description) reaches the cap.
    expect(resolveTargetInterviewQuestionCount(complexInput())).toBe(5);
  });

  it("falls back to the default focus set when no focus is provided", () => {
    const withDefault = generateDeterministicInterviewDraft({
      companyName: "Prelude",
      focus: [],
      jobDescription:
        "Support the operations team with day-to-day coordination and follow-up.",
      jobTitle: "Operations Associate",
      seniority: "mid",
    });

    // Default focus is role_skills + situational_judgment + motivation, so the
    // generator still produces a publishable multi-question draft.
    expect(withDefault.questions.length).toBeGreaterThanOrEqual(3);
    // The count tier must be computed from the default focus, not an empty set.
    expect(
      resolveTargetInterviewQuestionCount({
        focus: [],
        jobDescription:
          "Support the operations team with day-to-day coordination and follow-up.",
        jobTitle: "Operations Associate",
        seniority: "mid",
      }),
    ).toBeGreaterThanOrEqual(3);
  });

  it("computes estimatedMinutes as the duration sum rounded with a floor of 4", () => {
    const seniorities: InterviewSeniority[] = ["junior", "mid", "senior"];

    for (const seniority of seniorities) {
      const draft = generateDeterministicInterviewDraft({
        companyName: "Prelude",
        focus: allFocus,
        jobDescription:
          "Own onboarding, manage stakeholders, and improve support workflows for SMB customers.",
        jobTitle: "Customer Operations Lead",
        seniority,
      });

      const expectedMinutes = Math.max(
        4,
        Math.round(
          draft.questions.reduce(
            (sum, question) => sum + question.durationSeconds,
            0,
          ) / 60,
        ),
      );

      expect(draft.estimatedMinutes).toBe(expectedMinutes);
      // The floor must always hold regardless of how short the draft is.
      expect(draft.estimatedMinutes).toBeGreaterThanOrEqual(4);
    }
  });

  it("emits the full Hybrid shape on every generated question", () => {
    const draft = generateDeterministicInterviewDraft(complexInput());

    expect(draft.questions.length).toBeGreaterThan(0);
    for (const question of draft.questions) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
      expect(question.required).toBe(true);
      expect(question.maxFollowups).toBe(1);
      expect(question.expectedSignal.length).toBeGreaterThan(0);
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
});

// N10.B — compliance lock at the generator boundary. The deterministic generator
// must never emit its own protected-topic text: every question it produces, for
// every reasonable input, must pass textViolatesPolicy.
describe("N10 deterministic generator never emits protected-topic text", () => {
  const allFocus: InterviewFocus[] = [
    "role_skills",
    "situational_judgment",
    "motivation",
    "communication",
  ];
  const seniorities: InterviewSeniority[] = ["junior", "mid", "senior"];
  const roles: Array<{ jobTitle: string; jobDescription: string }> = [
    {
      jobTitle: "Senior Customer Operations Lead",
      jobDescription:
        "Own onboarding, manage stakeholders, and improve support workflows.",
    },
    { jobTitle: "CMO", jobDescription: "Own growth strategy and brand." },
    { jobTitle: "Buyer", jobDescription: "Manage procurement and suppliers." },
    { jobTitle: "HR Manager", jobDescription: "Run structured fair hiring." },
    { jobTitle: "AI Orchestrator", jobDescription: "Design AI workflows." },
    { jobTitle: "Restaurant Manager", jobDescription: "Run hospitality ops." },
    { jobTitle: "Logistics Coordinator", jobDescription: "Coordinate shipments." },
    { jobTitle: "Kitchen Assistant", jobDescription: "Prepare orders cleanly." },
  ];

  it("produces only policy-clean questions and criteria across roles, focus, and seniority", () => {
    for (const role of roles) {
      for (const seniority of seniorities) {
        // Empty focus exercises the default-focus path too.
        for (const focus of [allFocus, [] as InterviewFocus[]]) {
          const draft = generateDeterministicInterviewDraft({
            companyName: "Prelude",
            focus,
            jobDescription: role.jobDescription,
            jobTitle: role.jobTitle,
            seniority,
          });

          for (const question of draft.questions) {
            const text = `${question.prompt} ${question.expectedSignal}`;
            expect(
              textViolatesPolicy(text),
              `question flagged for ${role.jobTitle}/${seniority}: ${text}`,
            ).toBe(false);
          }

          for (const criterion of draft.criteria) {
            const text = `${criterion.label} ${criterion.description}`;
            expect(
              textViolatesPolicy(text),
              `criterion flagged for ${role.jobTitle}/${seniority}: ${text}`,
            ).toBe(false);
          }
        }
      }
    }
  });
});
