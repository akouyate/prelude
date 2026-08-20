import { describe, expect, it } from "vitest";

import { candidateExperiencePreviewSnapshotSchema } from "./candidate-preview";

describe("candidate experience preview snapshot", () => {
  it("accepts the canonical role plan plus candidate display context", () => {
    const snapshot = candidateExperiencePreviewSnapshotSchema.parse({
      companyName: "HireCall",
      jobId: "job_1",
      jobTitle: "Backend Engineer",
      plan: {
        criteria: [
          {
            description: "Explains a concrete production investigation.",
            id: "criterion_1",
            label: "Problem solving",
          },
        ],
        estimatedMinutes: 8,
        focus: ["role_skills"],
        guardrails: [],
        questions: [
          {
            category: "experience",
            id: "question_1",
            prompt:
              "Describe a production incident you investigated end to end.",
          },
        ],
        rationale: "Focused first screen.",
        responseModes: ["audio"],
        roleBrief: "Own backend services and incident response.",
        roleTitle: "Backend Engineer",
        seniority: "mid",
      },
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.plan.questions).toHaveLength(1);
  });

  it("pins marketing demo policy and supplemental questions in a v2 snapshot", () => {
    const snapshot = candidateExperiencePreviewSnapshotSchema.parse({
      schemaVersion: 2,
      variant: "marketing_demo",
      companyName: "HireCall",
      jobId: "job_demo",
      jobTitle: "Account Executive",
      plan: {
        criteria: [
          {
            description: "Explains a concrete customer conversation.",
            id: "criterion_1",
            label: "Customer discovery",
          },
        ],
        questions: [
          {
            id: "question_1",
            prompt:
              "Tell me about a customer conversation that changed your approach.",
          },
        ],
        responseModes: ["audio"],
        roleTitle: "Account Executive",
      },
      marketingDemo: {
        launchNonceDigest: "a".repeat(64),
        locale: "en",
        postInterviewQuestions: [
          {
            id: "confidence",
            max: 5,
            maxLabel: "Very confident",
            min: 1,
            minLabel: "Not confident",
            prompt: "How confident did you feel?",
            required: true,
            type: "scale",
          },
        ],
        returnTarget: "https://www.hirecall.ai/demo/result",
        roleSlug: "account-executive",
        roleVersion: 1,
      },
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      variant: "marketing_demo",
      marketingDemo: { roleSlug: "account-executive" },
    });
  });
});
