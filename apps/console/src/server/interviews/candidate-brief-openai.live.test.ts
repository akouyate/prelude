import type { CandidateBriefDto } from "@prelude/contracts";
import { describe, expect, it } from "vitest";

import {
  defaultCandidateBriefLlmModel,
  type CandidateBriefSynthesizerInput,
} from "./candidate-brief-generation";
import { createOpenAICandidateBriefSynthesizer } from "./candidate-brief-openai";
import { dominantStopwordLanguage } from "./text-language-heuristic";

const runLive =
  process.env.ALLOW_LIVE_LLM_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
    ? it
    : it.skip;

// The candidate answered in English; the workspace reads French. Rules 3 + 4:
// the analysis is generated natively in French, the quote survives untranslated.
const spokenAnswer =
  "I rebuilt the onboarding checklist after an enterprise customer churned in week three, and I ran a weekly risk review with support and product.";

describe("live OpenAI candidate brief generation", () => {
  runLive(
    "writes the analysis in French while keeping the English answer verbatim",
    async () => {
      const synthesizer = createOpenAICandidateBriefSynthesizer({
        apiKey: process.env.OPENAI_API_KEY!,
        model:
          process.env.CANDIDATE_BRIEF_LLM_MODEL ?? defaultCandidateBriefLlmModel,
        timeoutMs: 45_000,
      });

      const brief = await synthesizer.synthesize(input());

      expect(dominantStopwordLanguage(recruiterFacingText(brief))).toBe("fr");
      expect(JSON.stringify(brief)).toContain(spokenAnswer);
    },
    60_000,
  );
});

function recruiterFacingText(brief: CandidateBriefDto) {
  return [
    brief.summary ?? "",
    ...brief.limitations,
    ...brief.criteria.map((criterion) => criterion.rationale),
    brief.evaluationMatrix?.recommendationRationale ?? "",
  ].join(" ");
}

function input(): CandidateBriefSynthesizerInput {
  return {
    candidateLabel: "Ada",
    candidateSessionId: "cs_live_fr",
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
      realtimeSessionId: "is_live",
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
          text: spokenAnswer,
          turnId: "turn_a1",
        },
      ],
    },
    jobTitle: "Customer Success Manager",
    language: "fr",
    roleTitle: "Customer Success Manager",
  };
}
