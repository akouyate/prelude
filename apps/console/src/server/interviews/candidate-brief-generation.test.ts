import { describe, expect, it } from "vitest";

import {
  buildLocalCandidateBrief,
  createCandidateBriefSynthesizerFromEnv,
  createFallbackCandidateBriefSynthesizer,
  createLocalCandidateBriefSynthesizer,
  type CandidateBriefSynthesizerInput,
} from "./candidate-brief-generation";
import { dominantStopwordLanguage } from "./text-language-heuristic";

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
    expect(
      brief.evaluationMatrix?.criteria.map((criterion) => criterion.status),
    ).toEqual(["partial", "partial"]);
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
    expect(brief.status).toBe("insufficient_signal");
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

    expect(
      brief.criteria.every((criterion) => criterion.status === "Weak"),
    ).toBe(true);
    expect(brief.status).toBe("insufficient_signal");
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

    expect(brief.complianceFlags).toContain("sensitive_signal_review_required");
    expect(brief.status).toBe("insufficient_signal");
    expect(
      brief.criteria.every((criterion) => criterion.evidence.length === 0),
    ).toBe(true);
    expect(brief.limitations.join(" ")).toContain(
      "sensitive information was excluded",
    );
  });

  it("labels incomplete sessions with useful candidate evidence as partial", () => {
    const brief = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          completedAt: null,
          questionCompletionRate: 50,
          runtimeStatus: "in_progress",
          status: "abandoned",
          terminalEventType: null,
        },
      }),
    );

    expect(brief.status).toBe("partial");
    expect(brief.summary).toContain("partial");
    expect(brief.limitations).toContain(
      "Interview status is abandoned; do not treat this as a full completed screen.",
    );
    expect(brief.evaluationMatrix?.recommendationLabel).toBe(
      "targeted_follow_up",
    );
  });

  it("labels runtime failures as technical_failure without inventing a full brief", () => {
    const brief = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          completedAt: null,
          failedAt: "2026-06-20T10:03:00.000Z",
          questionCompletionRate: 0,
          runtimeStatus: "failed",
          status: "failed",
          terminalEventType: "session_failed",
          transcriptTurns: [],
        },
      }),
    );

    expect(brief.status).toBe("technical_failure");
    expect(brief.summary).toContain("technical failure");
    expect(brief.evaluationMatrix?.recommendationLabel).toBe("inconclusive");
    expect(brief.limitations).toContain(
      "The interview had a technical failure; do not interpret this as candidate weakness.",
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

// Plan 2026-08-18, rule 5: the deterministic brief is the production fallback
// when the LLM call fails or is unconfigured, so a failed call must never
// silently switch the product's language back to English.
describe("deterministic candidate brief language parity", () => {
  it("writes the whole fallback brief in French for a French workspace", () => {
    const brief = buildLocalCandidateBrief(input({ language: "fr" }));

    expect(dominantStopwordLanguage(recruiterFacingText(brief))).toBe("fr");
    expect(brief.summary).toContain("Ada");
    expect(brief.limitations.join(" ")).toContain("traits protégés");
    expect(brief.limitations.join(" ")).toContain("information sensible");
    expect(brief.evaluationMatrix?.recommendationRationale).toContain(
      "recruteur",
    );
  });

  it("keeps the English fallback brief English", () => {
    const brief = buildLocalCandidateBrief(input({ language: "en" }));

    expect(dominantStopwordLanguage(recruiterFacingText(brief))).toBe("en");
    expect(brief.limitations.join(" ")).toContain("protected traits");
  });

  it("localises every deterministic status path", () => {
    const partial = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          completedAt: null,
          questionCompletionRate: 50,
          runtimeStatus: "in_progress",
          status: "abandoned",
          terminalEventType: null,
        },
        language: "fr",
      }),
    );
    const technicalFailure = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          completedAt: null,
          failedAt: "2026-06-20T10:03:00.000Z",
          questionCompletionRate: 0,
          runtimeStatus: "failed",
          status: "failed",
          terminalEventType: "session_failed",
          transcriptTurns: [],
        },
        language: "fr",
      }),
    );
    const insufficient = buildLocalCandidateBrief(
      input({
        evidence: { ...input().evidence, transcriptTurns: [] },
        language: "fr",
      }),
    );

    expect(partial.status).toBe("partial");
    expect(dominantStopwordLanguage(recruiterFacingText(partial))).toBe("fr");
    expect(technicalFailure.status).toBe("technical_failure");
    expect(
      dominantStopwordLanguage(recruiterFacingText(technicalFailure)),
    ).toBe("fr");
    expect(insufficient.status).toBe("insufficient_signal");
    expect(dominantStopwordLanguage(recruiterFacingText(insufficient))).toBe(
      "fr",
    );
    expect(insufficient.limitations.join(" ")).toContain(
      "Aucun tour de parole",
    );
  });

  // French is wordier than English, and the brief schema caps several fields.
  // A maximum-length criterion label must not push the French copy past a cap
  // and turn the fallback itself into a generation failure.
  it("stays inside the schema caps with maximum-length criterion labels", () => {
    const label = "C".repeat(120);

    for (const language of ["en", "fr"] as const) {
      // Reviewable evidence: the criterion lands in `strengths`.
      expect(() =>
        buildLocalCandidateBrief(
          input({
            criteria: [
              { description: "Understands customer context.", id: "c1", label },
            ],
            language,
          }),
        ),
      ).not.toThrow();

      // Speech with nothing reviewable in it: the criterion lands in the
      // evaluation matrix's risks instead, which has its own cap.
      expect(() =>
        buildLocalCandidateBrief(
          input({
            criteria: [
              { description: "Understands customer context.", id: "c1", label },
            ],
            evidence: {
              ...input().evidence,
              transcriptTurns: [
                {
                  ...input().evidence.transcriptTurns[0]!,
                  text: "caca",
                },
              ],
            },
            language,
          }),
        ),
      ).not.toThrow();
    }
  });

  // Rule 4: quotes are audit evidence — the deterministic path copies the turn,
  // it never rewrites it into the workspace language.
  it("keeps candidate quotes in the language the candidate spoke", () => {
    const brief = buildLocalCandidateBrief(input({ language: "fr" }));

    expect(brief.criteria[0]?.evidence[0]?.text).toBe(
      input().evidence.transcriptTurns[0]?.text,
    );
    expect(brief.evaluationMatrix?.facts.join(" ")).toContain(
      "I led onboarding projects for enterprise customers",
    );
  });

  it("writes the fallback-was-used limitation in the workspace language", async () => {
    const synthesizer = createFallbackCandidateBriefSynthesizer({
      fallback: createLocalCandidateBriefSynthesizer(),
      primary: {
        modelName: "llm",
        provider: "llm",
        synthesize: async () => {
          throw new Error("network unavailable");
        },
      },
    });

    const brief = await synthesizer.synthesize(input({ language: "fr" }));

    expect(brief.limitations.join(" ")).toContain(
      "La synthèse LLM était indisponible",
    );
    expect(brief.limitations.join(" ")).not.toContain("LLM synthesis was");
  });
});

// Everything the recruiter reads as analysis. Verbatim candidate evidence is
// deliberately excluded: it stays in the spoken language, so it would poison a
// language check of the generated prose.
function recruiterFacingText(brief: ReturnType<typeof buildLocalCandidateBrief>) {
  return [
    brief.summary,
    ...brief.strengths,
    ...brief.risks,
    ...brief.pointsToClarify,
    ...brief.limitations,
    ...brief.criteria.map((criterion) => criterion.rationale),
    ...(brief.evaluationMatrix
      ? [
          brief.evaluationMatrix.recommendationRationale,
          ...brief.evaluationMatrix.missingInfo,
          ...brief.evaluationMatrix.risks,
          ...brief.evaluationMatrix.criteria.flatMap((criterion) => [
            criterion.rationale,
            ...criterion.followUps,
            ...criterion.missingInfo,
          ]),
        ]
      : []),
  ].join(" ");
}

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
    language: "en",
    roleTitle: "Customer Success Manager",
    ...overrides,
  };
}
