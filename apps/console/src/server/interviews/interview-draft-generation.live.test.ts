import { textViolatesPolicy } from "@prelude/core";
import { describe, expect, it } from "vitest";

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
});

function input(): InterviewDraftGenerationInput {
  return {
    companyName: "Prelude",
    focus: [
      "role_skills",
      "situational_judgment",
      "motivation",
      "communication",
    ],
    responseModes: ["audio", "text"],
    roleBrief:
      "We are hiring a Customer Success Manager to onboard SMB customers, spot early retention risks, coordinate with support and product, and communicate clearly with customers during implementation.",
    roleTitle: "Customer Success Manager",
    seniority: "mid",
  };
}
