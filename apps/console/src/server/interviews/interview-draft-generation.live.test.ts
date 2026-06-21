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
