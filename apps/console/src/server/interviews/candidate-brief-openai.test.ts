import { describe, expect, it } from "vitest";

import { createOpenAICandidateBriefSynthesizer } from "./candidate-brief-openai";
import type { CandidateBriefSynthesizerInput } from "./candidate-brief-generation";

describe("OpenAI candidate brief synthesizer", () => {
  it("parses a structured response without making a network request", async () => {
    const calls: Array<{ body: string; headers: Record<string, string> }> = [];
    const synthesizer = createOpenAICandidateBriefSynthesizer({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push({
          body: init.body,
          headers: init.headers,
        });

        return {
          json: async () => ({
            output_text: JSON.stringify(sampleBrief),
          }),
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ output_text: sampleBrief }),
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });

    const brief = await synthesizer.synthesize(input());

    expect(brief.candidateSessionId).toBe("cs_openai");
    expect(brief.evaluationMatrix?.recommendationLabel).toBe(
      "targeted_follow_up",
    );
    expect(calls[0]?.headers.Authorization).toBe("Bearer sk-test");
    const requestBody = JSON.parse(calls[0]?.body ?? "{}");

    expect(requestBody).toMatchObject({
      model: "gpt-test",
      store: false,
    });
    expect(JSON.stringify(requestBody)).toContain(
      "Disallowed question and review topics",
    );
    expect(JSON.stringify(requestBody)).toContain(
      "biometric or face analysis",
    );
    expect(JSON.stringify(requestBody)).toContain(
      "sensitive information was excluded",
    );
  });
});

const sampleBrief = {
  candidateSessionId: "cs_openai",
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
          text: "I coordinated support and product to reduce onboarding delays.",
          transcriptTurnId: "turn_1",
        },
      ],
      label: "Customer judgement",
      rationale: "The answer is relevant but needs quantified impact.",
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
            text: "I coordinated support and product to reduce onboarding delays.",
            transcriptTurnId: "turn_1",
          },
        ],
        followUps: ["What metric moved after the onboarding change?"],
        label: "Customer judgement",
        missingInfo: ["Quantified customer impact."],
        rationale: "Relevant first-screen signal with missing metric.",
        status: "partial",
      },
    ],
    facts: ["The candidate mentioned onboarding delays."],
    inferredSignals: [
      {
        confidence: "medium",
        evidence: [
          {
            questionId: "q1",
            text: "I coordinated support and product to reduce onboarding delays.",
            transcriptTurnId: "turn_1",
          },
        ],
        label: "Cross-functional customer work",
      },
    ],
    missingInfo: ["Quantified customer impact."],
    recommendationConfidence: "medium",
    recommendationLabel: "targeted_follow_up",
    recommendationRationale:
      "The recruiter should validate the concrete business impact before advancing.",
    recommendedNextStep: "to_review",
    risks: ["The business impact was not quantified."],
  },
  limitations: ["Human review is required before any hiring decision."],
  pointsToClarify: ["Clarify quantified customer impact."],
  risks: ["The business impact was not quantified."],
  status: "completed",
  strengths: ["Customer judgement: relevant first-screen signal."],
  suggestedNextStep: "to_review",
  summary:
    "The candidate gave relevant customer onboarding evidence, but the recruiter should validate the measurable impact.",
};

function input(): CandidateBriefSynthesizerInput {
  return {
    candidateLabel: "Ada",
    candidateSessionId: "cs_openai",
    criteria: [
      {
        description: "Understands customer context and trade-offs.",
        id: "customer_judgement",
        label: "Customer judgement",
      },
    ],
    evidence: {
      completedAt: "2026-06-20T10:05:00.000Z",
      eventCount: 4,
      failedAt: null,
      questionAnswerSequence: [],
      questionCompletionRate: 100,
      realtimeSessionId: "is_123",
      recording: null,
      runtimeStatus: "completed",
      status: "completed",
      terminalEventType: "session_completed",
      transcriptTurns: [
        {
          endedAt: "2026-06-20T10:00:10.000Z",
          eventType: "candidate_turn_finalized",
          questionId: "q1",
          sequenceNumber: 2,
          speaker: "candidate",
          startedAt: "2026-06-20T10:00:00.000Z",
          text: "I coordinated support and product to reduce onboarding delays.",
          turnId: "turn_1",
        },
      ],
    },
    jobTitle: "Customer Success Manager",
    roleTitle: "Customer Success Manager",
  };
}
