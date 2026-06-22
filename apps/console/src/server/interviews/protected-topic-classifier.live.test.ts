import { describe, expect, it } from "vitest";

import {
  createOpenAIProtectedTopicClassifier,
  defaultProtectedTopicModel,
} from "./protected-topic-classifier";

const runLive =
  process.env.ALLOW_LIVE_LLM_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
    ? it
    : it.skip;

// Semantic evasions the keyword layer cannot catch: paraphrase, coded language,
// and languages beyond EN/FR. The real model should flag every one of these.
const flagCases = [
  "Which decade did you wrap up your studies in?",
  "Will your home life let you travel this much?",
  "That's an unusual name — where's it originally from?",
  "¿Tienes hijos o piensas tenerlos pronto?",
  "Score how emotionally composed the candidate appears on camera.",
];

// Legitimate look-alikes that must NOT be flagged: work authorization as
// eligibility, ADA essential-function ability, system (not personal) health,
// and domain skills about patients.
const passCases = [
  "Are you legally authorized to work in France now and in the future without sponsorship?",
  "This role requires lifting up to 25 kg — can you perform that with or without reasonable accommodation?",
  "Décrivez comment vous surveillez l'état de santé d'un système en production.",
  "How do you support a patient managing a chronic illness day to day?",
];

describe("live OpenAI protected-topic classifier", () => {
  runLive(
    "flags semantic evasions and passes legitimate look-alikes",
    async () => {
      const classifier = createOpenAIProtectedTopicClassifier({
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.PROTECTED_TOPIC_LLM_MODEL ?? defaultProtectedTopicModel,
        timeoutMs: 30_000,
      });

      const segments = [...flagCases, ...passCases];
      const results = await classifier.classify(segments);

      expect(results).toHaveLength(segments.length);

      flagCases.forEach((_text, index) => {
        expect(results[index]?.flagged).toBe(true);
        expect(results[index]?.category).not.toBe("none");
      });

      passCases.forEach((_text, offset) => {
        const index = flagCases.length + offset;
        expect(results[index]?.flagged).toBe(false);
      });
    },
    60_000,
  );
});
