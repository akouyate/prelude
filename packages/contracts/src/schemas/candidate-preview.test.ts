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
});
