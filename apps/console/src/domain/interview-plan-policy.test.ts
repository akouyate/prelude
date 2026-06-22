import { describe, expect, it } from "vitest";

import { aiGuardrails } from "@prelude/core";

import {
  getInterviewPlanPublicationIssues,
  isInterviewPlanPublishable,
  planReferencesDisallowedTopic,
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
      category: "motivation",
      durationSeconds: 75,
      expectedSignal: "Role motivation",
      id: "motivation",
      maxFollowups: 1,
      prompt: "What made this role a strong next step for you?",
      required: true,
      source: "agent",
    },
    {
      category: "experience",
      durationSeconds: 90,
      expectedSignal: "Relevant experience",
      id: "experience",
      maxFollowups: 1,
      prompt: "Tell us about relevant experience for this role.",
      required: true,
      source: "job_description",
    },
    {
      category: "experience",
      durationSeconds: 90,
      expectedSignal: "Practical judgment",
      id: "judgment",
      maxFollowups: 1,
      prompt: "How would you handle a realistic ambiguous work situation?",
      required: true,
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

  it("rejects a plan whose only response mode is the dropped video mode", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      // A legacy row could still carry "video"; the policy no longer treats it
      // as a valid mode, so a video-only plan has no publishable mode left.
      responseModes: ["video"] as unknown as PublishableInterviewPlanInput["responseModes"],
    });

    expect(issues).toContain("Choose at least one candidate response mode.");
    expect(
      isInterviewPlanPublishable({
        ...publishablePlan,
        responseModes: ["video"] as unknown as PublishableInterviewPlanInput["responseModes"],
      }),
    ).toBe(false);
  });

  it("keeps a plan publishable when audio survives alongside a legacy video mode", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      responseModes: ["audio", "video"] as unknown as PublishableInterviewPlanInput["responseModes"],
    });

    expect(issues).not.toContain("Choose at least one candidate response mode.");
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

  it("rejects plans whose questions reference a protected topic", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      questions: [
        {
          category: "motivation",
          durationSeconds: 75,
          expectedSignal: "Role motivation",
          id: "age",
          maxFollowups: 1,
          prompt: "What is your age?",
          required: true,
          source: "agent",
        },
        ...publishablePlan.questions.slice(1),
      ],
    });

    expect(issues).toContain(
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    );
  });

  it("rejects a plan whose question follow-up references a protected topic", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      questions: [
        {
          ...publishablePlan.questions[0]!,
          followUpPrompt: "And just to confirm — what is your age?",
        },
        ...publishablePlan.questions.slice(1),
      ],
    });

    expect(issues).toContain(
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    );
  });

  it("rejects plans whose criteria reference a protected topic", () => {
    const issues = getInterviewPlanPublicationIssues({
      ...publishablePlan,
      criteria: [
        {
          description: "Rate the candidate's age and overall energy.",
          id: "age",
          label: "Age fit",
        },
        ...publishablePlan.criteria.slice(1),
      ],
    });

    expect(issues).toContain(
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    );
  });

  it("flags a plan whose question references a protected topic", () => {
    expect(
      planReferencesDisallowedTopic({
        criteria: [],
        questions: [
          { prompt: "What is your age?", expectedSignal: "Experience" },
        ],
      }),
    ).toBe(true);
  });

  it("flags a plan whose question FOLLOW-UP references a protected topic", () => {
    // The prompt and expectedSignal are clean; only the generated follow-up
    // smuggles a protected topic. This must still be caught — the follow-up is
    // spoken to the candidate just like the question.
    expect(
      planReferencesDisallowedTopic({
        criteria: [],
        questions: [
          {
            prompt: "Describe a project you led under deadline.",
            expectedSignal: "Delivery",
            followUpPrompt: "Just to confirm — what is your age?",
          },
        ],
      }),
    ).toBe(true);
  });

  it("flags a plan whose criterion references a protected topic", () => {
    expect(
      planReferencesDisallowedTopic({
        criteria: [
          { description: "Rate the candidate's age.", label: "Age fit" },
        ],
        questions: [],
      }),
    ).toBe(true);
  });

  it("passes a plan with only job-related text", () => {
    expect(
      planReferencesDisallowedTopic({
        criteria: [{ description: "Structured, concrete answers.", label: "Clarity" }],
        questions: [
          {
            prompt: "Describe a project you led under deadline.",
            expectedSignal: "Delivery",
          },
        ],
      }),
    ).toBe(false);
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
