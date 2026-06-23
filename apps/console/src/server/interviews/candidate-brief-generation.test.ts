import { describe, expect, it } from "vitest";

import {
  buildLocalCandidateBrief,
  createCandidateBriefSynthesizerFromEnv,
  createFallbackCandidateBriefSynthesizer,
  type CandidateBriefSynthesizerInput,
} from "./candidate-brief-generation";

describe("candidate brief generation", () => {
  it("builds a structured brief from transcript evidence", () => {
    const brief = buildLocalCandidateBrief(input());

    expect(brief.status).toBe("completed");
    expect(brief.summary).toContain("Ada");
    expect(brief.criteria).toHaveLength(2);
    expect(brief.criteria.map((criterion) => criterion.status)).toEqual([
      "Medium",
      "Medium",
    ]);
    expect(brief.criteria[0]?.evidence[0]).toMatchObject({
      questionId: "q1",
      transcriptTurnId: "turn_a1",
    });
    expect(brief.complianceFlags).toEqual(
      expect.arrayContaining([
        "human_review_required",
        "protected_traits_excluded",
        "biometric_scoring_disallowed",
      ]),
    );
    expect(JSON.stringify(brief).toLowerCase()).not.toContain("score");
    expect(brief.limitations.join(" ")).toContain("protected traits");
    expect(brief.evaluationMatrix).toMatchObject({
      recommendationLabel: "targeted_follow_up",
      recommendedNextStep: "to_review",
    });
    expect(brief.evaluationMatrix?.criteria.map((criterion) => criterion.status)).toEqual([
      "partial",
      "partial",
    ]);
  });

  it("marks criteria not assessable when transcript evidence is missing", () => {
    const brief = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          questionCompletionRate: 50,
          transcriptTurns: [],
        },
      }),
    );

    expect(
      brief.criteria.every(
        (criterion) => criterion.status === "Not assessable",
      ),
    ).toBe(true);
    expect(brief.limitations).toContain(
      "No candidate transcript turns were available.",
    );
    expect(brief.limitations).toContain(
      "The interview did not complete every planned question.",
    );
    expect(brief.pointsToClarify).toContain("Clarify customer judgement.");
    expect(brief.evaluationMatrix?.recommendationLabel).toBe("inconclusive");
  });

  it("does not treat absurd speech as reviewable evidence", () => {
    const brief = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          transcriptTurns: [
            {
              endedAt: "2026-06-20T10:00:03.000Z",
              eventType: "candidate_turn_finalized",
              questionId: "q1",
              sequenceNumber: 2,
              speaker: "candidate",
              startedAt: "2026-06-20T10:00:00.000Z",
              text: "caca",
              turnId: "turn_bad",
            },
          ],
        },
      }),
    );

    expect(brief.criteria.every((criterion) => criterion.status === "Weak")).toBe(
      true,
    );
    expect(
      brief.criteria.every((criterion) => criterion.evidence.length === 0),
    ).toBe(true);
    expect(brief.evaluationMatrix?.recommendationLabel).toBe("inconclusive");
    expect(brief.evaluationMatrix?.criteria[0]?.status).toBe("risk");
  });

  it("excludes volunteered sensitive information from recruiter evidence", () => {
    const brief = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          transcriptTurns: [
            {
              endedAt: "2026-06-20T10:00:08.000Z",
              eventType: "candidate_turn_finalized",
              questionId: "q1",
              sequenceNumber: 2,
              speaker: "candidate",
              startedAt: "2026-06-20T10:00:00.000Z",
              text: "I am pregnant, but I have managed onboarding projects for support teams.",
              turnId: "turn_sensitive",
            },
          ],
        },
      }),
    );

    expect(brief.complianceFlags).toContain(
      "sensitive_signal_review_required",
    );
    expect(brief.criteria.every((criterion) => criterion.evidence.length === 0)).toBe(
      true,
    );
    expect(brief.limitations.join(" ")).toContain(
      "sensitive information was excluded",
    );
  });

  it("keeps the local synthesizer as the default when live LLM is not enabled", () => {
    const synthesizer = createCandidateBriefSynthesizerFromEnv({
      OPENAI_API_KEY: "sk-test",
    });

    expect(synthesizer.provider).toBe("local_synthesis");
  });

  it("selects an OpenAI-backed synthesizer with local fallback only when enabled", () => {
    const synthesizer = createCandidateBriefSynthesizerFromEnv({
      CANDIDATE_BRIEF_LLM_ENABLED: "1",
      CANDIDATE_BRIEF_LLM_MODEL: "gpt-test",
      OPENAI_API_KEY: "sk-test",
    });

    expect(synthesizer.modelName).toBe("gpt-test");
    expect(synthesizer.provider).toBe(
      "openai_responses_with_local_synthesis_fallback",
    );
  });

  it("falls back to local synthesis if the primary provider fails", async () => {
    const synthesizer = createFallbackCandidateBriefSynthesizer({
      fallback: {
        modelName: "local",
        provider: "local",
        synthesize: async (value) => buildLocalCandidateBrief(value),
      },
      primary: {
        modelName: "llm",
        provider: "llm",
        synthesize: async () => {
          throw new Error("network unavailable");
        },
      },
    });

    const brief = await synthesizer.synthesize(input());

    expect(brief.status).toBe("completed");
    expect(brief.limitations).toContain(
      "LLM synthesis was unavailable; a conservative local fallback was used.",
    );
  });
});

function input(
  overrides: Partial<CandidateBriefSynthesizerInput> = {},
): CandidateBriefSynthesizerInput {
  return {
    candidateLabel: "Ada",
    candidateSessionId: "cs_123",
    criteria: [
      {
        description: "Understands customer context and trade-offs.",
        id: "customer_judgement",
        label: "Customer judgement",
      },
      {
        description: "Communicates clearly in a first screen.",
        id: "communication",
        label: "Communication",
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
          text: "I led onboarding projects for enterprise customers and coordinated support, product, and customer success teams to reduce activation delays.",
          turnId: "turn_a1",
        },
      ],
    },
    jobTitle: "Customer Success Manager",
    roleTitle: "Customer Success Manager",
    ...overrides,
  };
}
