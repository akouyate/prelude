import { describe, expect, it } from "vitest";

import {
  candidateExperiencePreviewSnapshotSchema,
  marketingDemoHandoffExchangeResponseSchema,
  marketingDemoHandoffResponseSchema,
  marketingDemoHandoffSubmissionSchema,
  marketingDemoLeadSubmissionSchema,
} from "./candidate-preview";

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

describe("marketing demo handoff submission", () => {
  it("accepts only the preview and completed runtime identifiers", () => {
    const input = {
      previewToken: `pvtk_${"s".repeat(43)}`,
      sessionId: "is_demo",
    };

    expect(marketingDemoHandoffSubmissionSchema.parse(input)).toEqual(input);
    expect(
      marketingDemoHandoffSubmissionSchema.safeParse({
        ...input,
        answers: [{ questionId: "confidence", value: 4 }],
      }).success,
    ).toBe(false);
    expect(
      marketingDemoHandoffSubmissionSchema.safeParse({
        ...input,
        transcript: [{ speaker: "candidate", text: "private answer" }],
      }).success,
    ).toBe(false);
  });
});

describe("marketing demo handoff response", () => {
  it("rejects candidate content and exposes only role metadata", () => {
    const payload = {
      completed: true,
      roleSlug: "account-executive",
      roleTitle: "Account Executive",
      roleVersion: 1,
    } as const;

    expect(marketingDemoHandoffResponseSchema.parse(payload)).toEqual(payload);
    expect(
      marketingDemoHandoffResponseSchema.safeParse({
        ...payload,
        transcript: [{ speaker: "candidate", text: "private answer" }],
      }).success,
    ).toBe(false);
    expect(
      marketingDemoHandoffResponseSchema.safeParse({
        ...payload,
        answers: [{ questionId: "confidence", value: 4 }],
      }).success,
    ).toBe(false);
  });

  it("adds only an opaque, expiring lead-capture proof after exchange", () => {
    const response = {
      completed: true,
      leadCaptureToken: `mdlc_${"l".repeat(43)}`,
      leadCaptureTokenExpiresAt: "2026-08-21T10:30:00.000Z",
      roleSlug: "account-executive",
      roleTitle: "Account Executive",
      roleVersion: 1,
    } as const;

    expect(marketingDemoHandoffExchangeResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      marketingDemoHandoffExchangeResponseSchema.safeParse({
        ...response,
        transcript: [{ speaker: "candidate", text: "private answer" }],
      }).success,
    ).toBe(false);
  });
});

describe("marketing demo lead submission", () => {
  it("requires a completed-demo proof and keeps marketing consent optional", () => {
    const input = {
      captureToken: `mdlc_${"l".repeat(43)}`,
      email: "buyer@example.com",
      marketingConsent: true,
    } as const;

    expect(marketingDemoLeadSubmissionSchema.parse(input)).toEqual(input);
    expect(
      marketingDemoLeadSubmissionSchema.parse({
        ...input,
        marketingConsent: false,
      }),
    ).toEqual({ ...input, marketingConsent: false });
    expect(
      marketingDemoLeadSubmissionSchema.safeParse({
        ...input,
        roleSlug: "visitor-authored-role",
      }).success,
    ).toBe(false);
  });
});
