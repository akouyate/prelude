import { describe, expect, it } from "vitest";

import { aiGuardrails } from "@prelude/core";

import {
  getInterviewPlanPublicationIssues,
  isInterviewPlanPublishable,
  resolveInterviewDraftPublicationMode,
  type PublishableInterviewPlanInput,
} from "./interview-plan-policy";

const publishablePlan: PublishableInterviewPlanInput = {
  criteria: [
    {
      description: "Candidate gives concrete examples tied to role needs.",
      id: "evidence",
      label: "Relevant evidence",
    },
    {
      description:
        "Candidate explains practical next steps in realistic cases.",
      id: "judgment",
      label: "Practical judgment",
    },
    {
      description:
        "Candidate answers are structured enough for recruiter review.",
      id: "clarity",
      label: "Clarity",
    },
  ],
  guardrails: [
    "Ask every candidate the same questions in the same order.",
    "Evaluate answers against job-related criteria only.",
    ...aiGuardrails,
  ],
  questions: [
    {
      durationSeconds: 75,
      id: "motivation",
      prompt: "What made this role a strong next step for you?",
      signal: "Role motivation",
      source: "agent",
    },
    {
      durationSeconds: 90,
      id: "experience",
      prompt: "Tell us about relevant experience for this role.",
      signal: "Relevant experience",
      source: "job_description",
    },
    {
      durationSeconds: 90,
      id: "judgment",
      prompt: "How would you handle a realistic ambiguous work situation?",
      signal: "Practical judgment",
      source: "job_description",
    },
  ],
  responseModes: ["audio", "text"],
  roleBrief:
    "We need a customer-facing teammate who can handle onboarding, communication, and practical prioritization.",
  roleTitle: "Customer Success Manager",
};

describe("interview plan publication policy", () => {
  it("accepts a complete first-screen interview plan", () => {
    expect(isInterviewPlanPublishable(publishablePlan)).toBe(true);
  });

  it("rejects plans with too few questions and criteria", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      criteria: publishablePlan.criteria.slice(0, 2),
      questions: publishablePlan.questions.slice(0, 2),
    });

    expect(issues).toContain("Approve at least 3 job-related questions.");
    expect(issues).toContain("Approve at least 3 evaluation criteria.");
  });

  it("rejects plans without compliance guardrails", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      guardrails: ["Be nice."],
    });

    expect(issues).toContain(
      "Keep the required compliance guardrails before publishing.",
    );
  });

  it("creates the first immutable snapshot when no interview exists", () => {
    expect(
      resolveInterviewDraftPublicationMode({
        draftStatus: "draft",
        hasPublishedSnapshot: false,
      }),
    ).toBe("create_initial_snapshot");
  });

  it("returns the existing snapshot when the published draft did not change", () => {
    expect(
      resolveInterviewDraftPublicationMode({
        draftStatus: "published",
        hasPublishedSnapshot: true,
      }),
    ).toBe("return_existing_snapshot");
  });

  it("creates a new snapshot when a previously published draft changed", () => {
    expect(
      resolveInterviewDraftPublicationMode({
        draftStatus: "draft",
        hasPublishedSnapshot: true,
      }),
    ).toBe("create_republished_snapshot");
  });
});
