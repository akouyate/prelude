import { textViolatesPolicy } from "@prelude/core";
import { describe, expect, it } from "vitest";

import { dominantStopwordLanguage } from "./text-language-heuristic";
import {
  createOpenAIInterviewDraftGenerator,
  defaultInterviewDraftLlmModel,
  type InterviewDraftGenerationInput,
} from "./interview-draft-generation";

const runLive =
  process.env.ALLOW_LIVE_LLM_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
    ? it
    : it.skip;

describe("live OpenAI interview draft generation", () => {
  runLive(
    "generates a publishable role draft with the real provider",
    async () => {
      const generator = createOpenAIInterviewDraftGenerator({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.INTERVIEW_DRAFT_LLM_MODEL ?? defaultInterviewDraftLlmModel,
        timeoutMs: 30_000,
      });

      const draft = await generator.generateDraft(input());

      expect(draft.questions.length).toBeGreaterThanOrEqual(3);
      expect(draft.questions.length).toBeLessThanOrEqual(5);
      expect(draft.criteria.length).toBeGreaterThanOrEqual(3);
      expect(draft.guardrails.join(" ")).toContain(
        "Ask every candidate the same questions",
      );
      expect(draft.questions.every((question) => question.prompt.length > 8)).toBe(
        true,
      );

      for (const question of draft.questions) {
        const followUp = question.followUpPrompt ?? "";
        // Every question ships a bounded, signal-aware follow-up the live agent
        // speaks verbatim.
        expect(followUp.length).toBeGreaterThanOrEqual(8);
        // It must clear the same compliance gate as the question itself.
        expect(textViolatesPolicy(followUp)).toBe(false);
        // It must elicit, not telegraph: it never restates the expected signal.
        expect(followUp.toLowerCase()).not.toContain(
          question.expectedSignal.toLowerCase(),
        );
      }
    },
    45_000,
  );

  // Plan 2026-08-18, rule 8: the offline tests can only prove the prompt CARRIES
  // the directive. This one proves the model actually OBEYS it — the failure
  // mode this whole chantier exists to close is a French workspace silently
  // receiving English questions.
  runLive(
    "writes the candidate-facing draft in French when the interview language is fr",
    async () => {
      const generator = createOpenAIInterviewDraftGenerator({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.INTERVIEW_DRAFT_LLM_MODEL ?? defaultInterviewDraftLlmModel,
        timeoutMs: 30_000,
      });

      const draft = await generator.generateDraft(
        input({ interviewLanguage: "fr", workspaceLanguage: "fr" }),
      );

      // Judged over the whole candidate-facing surface: a single question could
      // plausibly be short enough to read as ambiguous, the set cannot.
      const candidateFacingText = draft.questions
        .map(
          (question) =>
            `${question.prompt} ${question.expectedSignal} ${question.followUpPrompt ?? ""}`,
        )
        .join(" ");

      expect(dominantStopwordLanguage(candidateFacingText)).toBe("fr");
      expect(
        dominantStopwordLanguage(
          draft.criteria
            .map((criterion) => `${criterion.label} ${criterion.description}`)
            .join(" "),
        ),
      ).toBe("fr");
      // Localizing must not cost the compliance gate.
      for (const question of draft.questions) {
        expect(
          textViolatesPolicy(
            `${question.prompt} ${question.expectedSignal} ${question.followUpPrompt ?? ""}`,
          ),
        ).toBe(false);
      }
    },
    45_000,
  );

  // The split directive is the harder instruction to follow, so it gets its own
  // live assertion rather than riding on the collapsed one.
  runLive(
    "keeps the rationale in the workspace language while the questions are French",
    async () => {
      const generator = createOpenAIInterviewDraftGenerator({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.INTERVIEW_DRAFT_LLM_MODEL ?? defaultInterviewDraftLlmModel,
        timeoutMs: 30_000,
      });

      const draft = await generator.generateDraft(
        input({ interviewLanguage: "fr", workspaceLanguage: "en" }),
      );

      expect(
        dominantStopwordLanguage(
          draft.questions.map((question) => question.prompt).join(" "),
        ),
      ).toBe("fr");
      // The rationale is one or two sentences, which can fall under the
      // heuristic's minimum-signal floor and come back `null`. Only a confident
      // FRENCH verdict means the split directive was ignored, so that is what
      // this asserts — a thin sample must not fail the run on its own.
      expect(dominantStopwordLanguage(draft.rationale)).not.toBe("fr");
    },
    45_000,
  );
});

function input(
  overrides: Partial<InterviewDraftGenerationInput> = {},
): InterviewDraftGenerationInput {
  return {
    companyName: "HireCall",
    focus: [
      "role_skills",
      "situational_judgment",
      "motivation",
      "communication",
    ],
    interviewLanguage: "en",
    responseModes: ["audio", "text"],
    roleBrief:
      "We are hiring a Customer Success Manager to onboard SMB customers, spot early retention risks, coordinate with support and product, and communicate clearly with customers during implementation.",
    roleTitle: "Customer Success Manager",
    seniority: "mid",
    workspaceLanguage: "en",
    ...overrides,
  };
}
