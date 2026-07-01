import { describe, expect, it } from "vitest";

import { candidateBriefSchema } from "./brief";

describe("candidate brief schema", () => {
  it("keeps legacy candidate briefs valid when no evaluation matrix exists", () => {
    const parsed = candidateBriefSchema.parse({
      candidateSessionId: "cs_legacy",
      criteria: [
        {
          criterionId: "communication",
          evidence: [],
          label: "Communication",
          rationale: "Not enough evidence.",
          status: "Not assessable",
        },
      ],
      limitations: ["Human review is required before any hiring decision."],
      status: "completed",
      suggestedNextStep: "to_review",
    });

    expect(parsed.evaluationMatrix).toBeUndefined();
    expect(parsed.criteria[0]?.status).toBe("Not assessable");
  });

  it("accepts a richer evidence-backed evaluation matrix", () => {
    const parsed = candidateBriefSchema.parse({
      candidateSessionId: "cs_matrix",
      complianceFlags: [
        "human_review_required",
        "protected_traits_excluded",
        "biometric_scoring_disallowed",
      ],
      criteria: [
        {
          criterionId: "customer_judgement",
          evidence: [
            {
              questionId: "q1",
              text: "I reduced activation delays by coordinating support and product.",
              transcriptTurnId: "turn_1",
            },
          ],
          label: "Customer judgement",
          rationale: "Usable first-screen evidence.",
          status: "Medium",
        },
      ],
      evaluationMatrix: {
        criteria: [
          {
            category: "experience",
            confidence: "medium",
            criterionId: "customer_judgement",
            evidence: [
              {
                questionId: "q1",
                text: "I reduced activation delays by coordinating support and product.",
                transcriptTurnId: "turn_1",
              },
            ],
            followUps: ["What metric moved after that onboarding change?"],
            label: "Customer judgement",
            missingInfo: ["Exact activation metric."],
            rationale:
              "The answer is relevant and concrete enough for recruiter review, but the metric is missing.",
            status: "partial",
          },
        ],
        facts: [
          "The candidate mentioned onboarding and cross-functional work.",
        ],
        inferredSignals: [
          {
            confidence: "medium",
            evidence: [
              {
                questionId: "q1",
                text: "I reduced activation delays by coordinating support and product.",
                transcriptTurnId: "turn_1",
              },
            ],
            label: "Cross-functional customer work",
          },
        ],
        missingInfo: ["Exact activation metric."],
        recommendationConfidence: "medium",
        recommendationLabel: "targeted_follow_up",
        recommendationRationale:
          "There is useful signal, but a recruiter should validate the business impact.",
        recommendedNextStep: "to_review",
        risks: ["Business impact is not quantified."],
      },
      limitations: ["Human review is required before any hiring decision."],
      status: "completed",
      suggestedNextStep: "to_review",
    });

    expect(parsed.evaluationMatrix?.criteria[0]?.status).toBe("partial");
    expect(parsed.evaluationMatrix?.recommendationLabel).toBe(
      "targeted_follow_up",
    );
  });

  it("rejects autonomous archive recommendations in the evaluation matrix", () => {
    const parsed = candidateBriefSchema.safeParse({
      candidateSessionId: "cs_archive",
      evaluationMatrix: {
        criteria: [],
        facts: [],
        inferredSignals: [],
        missingInfo: [],
        recommendationConfidence: "low",
        recommendationLabel: "inconclusive",
        recommendationRationale: "Missing evidence.",
        recommendedNextStep: "archived",
        risks: [],
      },
      limitations: ["Human review is required before any hiring decision."],
      status: "completed",
    });

    expect(parsed.success).toBe(false);
  });

  it.each(["partial", "insufficient_signal", "technical_failure"] as const)(
    "accepts non-complete lifecycle-aware brief status %s",
    (status) => {
      const parsed = candidateBriefSchema.parse({
        candidateSessionId: `cs_${status}`,
        limitations: ["Human review is required before any hiring decision."],
        status,
      });

      expect(parsed.status).toBe(status);
    },
  );
});
