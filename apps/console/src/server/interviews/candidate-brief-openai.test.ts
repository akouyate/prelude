import type { WorkspaceLanguage } from "@prelude/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCandidateBriefSystemInstructions,
  createOpenAICandidateBriefSynthesizer,
} from "./candidate-brief-openai";
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
    expect(JSON.stringify(requestBody)).toContain(
      "Do not treat a request to repeat, clarify, or reformulate",
    );
  });

  it("carries the workspace output language into the request", async () => {
    const calls: string[] = [];
    const synthesizer = createOpenAICandidateBriefSynthesizer({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push(init.body);

        return {
          json: async () => ({ output_text: JSON.stringify(sampleBrief) }),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });

    await synthesizer.synthesize(input({ language: "fr" }));

    expect(calls[0]).toContain("in French");
  });
});

describe("candidate brief output-language directive", () => {
  // Plan 2026-08-18, rules 3 + 4: one explicit output-language instruction for
  // the recruiter-facing analysis, and candidate quotes stay in the language
  // actually spoken because they are audit evidence tied to transcript turns.
  const cases = [
    ["fr", "French"],
    ["en", "English"],
  ] as const satisfies readonly (readonly [WorkspaceLanguage, string])[];

  it.each(cases)(
    "names the output language for the %s workspace",
    (language, languageName) => {
      const instructions = buildCandidateBriefSystemInstructions(language);

      expect(instructions).toContain(`in ${languageName}`);
      expect(instructions).toContain("summary");
      expect(instructions).toContain("recommendation");
      expect(instructions).toContain("limitations");
    },
  );

  it.each(cases)(
    "keeps candidate quotes verbatim for the %s workspace",
    (language) => {
      const instructions = buildCandidateBriefSystemInstructions(language);

      expect(instructions).toContain("verbatim");
      expect(instructions).toContain("Never translate");
      expect(instructions.toLowerCase()).toContain("paraphrase");
      expect(instructions).toContain("audit evidence");
    },
  );

  // An abstract rule is easy for a model to satisfy in spirit and break in
  // practice, so the directive shows the failure it is guarding against.
  it.each(cases)(
    "shows a translated-quote counter-example for the %s workspace",
    (language) => {
      const instructions = buildCandidateBriefSystemInstructions(language);

      expect(instructions).toContain('"I shipped the migration alone"');
      expect(instructions).toContain('"J\'ai fait la migration tout seul"');
    },
  );

  // Language is an input fact the server stamps on the row, never something the
  // model reports back — same rule the draft generator's schema clause states.
  it.each(cases)(
    "forbids a language field in the output for the %s workspace",
    (language) => {
      const instructions = buildCandidateBriefSystemInstructions(language);

      expect(instructions).toContain("never add a language field");
    },
  );

  it("keeps the instructions themselves and the schema keys English", () => {
    const instructions = buildCandidateBriefSystemInstructions("fr");

    // Rule 3: prompt instructions stay English, only values are localized. The
    // one French fragment is the counter-example above, kept accent-free so
    // this stays a cheap invariant rather than a carve-out.
    expect(instructions).not.toMatch(/[éèêàçù]/u);
    expect(instructions).toContain("JSON keys");
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

function input(
  overrides: Partial<CandidateBriefSynthesizerInput> = {},
): CandidateBriefSynthesizerInput {
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
    language: "en",
    roleTitle: "Customer Success Manager",
    ...overrides,
  };
}
