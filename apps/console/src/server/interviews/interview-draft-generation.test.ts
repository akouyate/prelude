import { describe, expect, it } from "vitest";

import {
  createDeterministicInterviewDraftGenerator,
  createInterviewDraftGeneratorFromEnv,
  createOpenAIInterviewDraftGenerator,
  type InterviewDraftGenerationInput,
} from "./interview-draft-generation";

describe("interview draft generation", () => {
  it("uses a deterministic provider when explicitly configured", () => {
    const generator = createInterviewDraftGeneratorFromEnv({
      INTERVIEW_DRAFT_GENERATOR: "deterministic",
      OPENAI_API_KEY: "sk-test",
    });

    expect(generator.provider).toBe("deterministic_test_generator");
  });

  it("fails closed for unknown providers in production", () => {
    const generator = createInterviewDraftGeneratorFromEnv({
      INTERVIEW_DRAFT_GENERATOR: "unknown",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    });

    expect(generator.provider).toBe("unavailable");
  });

  it("generates a four-question first screen for a standard rich role", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(input());

    expect(draft.questions).toHaveLength(4);
    expect(draft.criteria.length).toBeGreaterThanOrEqual(3);
    expect(draft.guardrails.join(" ")).toContain(
      "Ask every candidate the same questions",
    );
  });

  it("adds and refines questions through deterministic provider methods", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(input());
    const added = await generator.addQuestion({
      ...input(),
      draft,
      topic: "mobility",
    });
    const refined = await generator.refineQuestion({
      ...input(),
      action: "sharper",
      draft,
      question: draft.questions[0]!,
    });

    expect(added.prompt).toContain("availability");
    expect(refined.prompt).toContain("situation");
  });

  it("parses OpenAI structured draft output without making a network request", async () => {
    const calls: Array<{ body: string; headers: Record<string, string> }> = [];
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push({
          body: init.body,
          headers: init.headers,
        });

        return {
          json: async () => ({
            output_text: JSON.stringify(sampleDraft),
          }),
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ output_text: sampleDraft }),
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });

    const draft = await generator.generateDraft(input());

    expect(draft.questions).toHaveLength(4);
    expect(draft.criteria).toHaveLength(3);
    expect(calls[0]?.headers.Authorization).toBe("Bearer sk-test");

    const requestBody = JSON.parse(calls[0]?.body ?? "{}");

    expect(requestBody).toMatchObject({
      model: "gpt-test",
      store: false,
    });
    expect(requestBody.text.format.strict).toBe(true);
    const promptInput = JSON.parse(requestBody.input[1].content);

    expect(promptInput.targetQuestionCount).toBe(4);
    expect(JSON.stringify(requestBody)).toContain("protected traits");
    expect(JSON.stringify(requestBody)).toContain("biometric");
  });

  it("falls back when OpenAI returns a disallowed single-question payload", async () => {
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            durationSeconds: 60,
            id: "unsafe",
            prompt: "How old are you?",
            signal: "Age",
            source: "agent",
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      model: "gpt-test",
      timeoutMs: 1000,
    });
    const draft = await createDeterministicInterviewDraftGenerator().generateDraft(
      input(),
    );

    const added = await generator.addQuestion({
      ...input(),
      draft,
      topic: "mobility",
    });
    const refined = await generator.refineQuestion({
      ...input(),
      action: "sharper",
      draft,
      question: draft.questions[0]!,
    });

    expect(added.prompt).toContain("availability");
    expect(refined.id).toBe(draft.questions[0]!.id);
    expect(refined.prompt).toContain("Please include the situation");
  });

  it("falls back to deterministic draft when OpenAI fails", async () => {
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({}),
        ok: false,
        status: 500,
        text: async () => "server error",
      }),
      model: "gpt-test",
      timeoutMs: 1000,
    });

    const draft = await generator.generateDraft(input());

    expect(draft.questions).toHaveLength(4);
    expect(draft.rationale).toContain("Prelude prepared 4 focused");
  });

  it("drops malformed and unsafe draft items before filling with deterministic content", async () => {
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            ...sampleDraft,
            criteria: [
              { id: "bad", label: "", description: "" },
              {
                description: "Use job-related evidence only.",
                id: "safe",
                label: "Evidence",
              },
              {
                description: "Create a fit score.",
                id: "unsafe",
                label: "Ranking",
              },
            ],
            questions: [
              { id: "bad", prompt: "", signal: "", source: "agent" },
              {
                durationSeconds: 60,
                id: "unsafe",
                prompt: "How old are you?",
                signal: "Age",
                source: "agent",
              },
              sampleDraft.questions[0],
            ],
            rationale: "Rank candidates by fit score.",
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      model: "gpt-test",
      timeoutMs: 1000,
    });

    const draft = await generator.generateDraft(input());
    const content = JSON.stringify(draft).toLowerCase();

    expect(draft.questions).toHaveLength(4);
    expect(draft.criteria.length).toBeGreaterThanOrEqual(3);
    expect(content).not.toContain("how old are you");
    expect(content).not.toContain("fit score");
    expect(draft.rationale).toContain("Prelude prepared 4 focused");
  });
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
    responseModes: ["text", "audio"],
    roleBrief:
      "We are hiring a Customer Success Manager to onboard SMB customers, reduce churn risk, coordinate with product teams, and turn customer feedback into practical improvements.",
    roleTitle: "Customer Success Manager",
    seniority: "mid",
  };
}

const sampleDraft = {
  criteria: [
    {
      description: "Examples connect to onboarding and customer outcomes.",
      id: "relevant-evidence",
      label: "Relevant evidence",
    },
    {
      description: "Shows practical judgment in ambiguous customer situations.",
      id: "judgment",
      label: "Practical judgment",
    },
    {
      description: "Answers are clear and concise.",
      id: "communication",
      label: "Communication",
    },
  ],
  estimatedMinutes: 6,
  guardrails: [
    "Ask every candidate the same questions in the same order.",
    "Analyze only candidate response content.",
    "Do not make automatic hiring or rejection decisions.",
  ],
  questions: [
    {
      durationSeconds: 75,
      id: "motivation",
      prompt:
        "What made this Customer Success Manager role interesting to you?",
      signal: "Role motivation and clarity of expectations",
      source: "agent",
    },
    {
      durationSeconds: 90,
      id: "onboarding",
      prompt:
        "Tell us about a customer onboarding project you handled and what changed because of your work.",
      signal: "Relevant customer onboarding evidence",
      source: "job_description",
    },
    {
      durationSeconds: 90,
      id: "judgment",
      prompt:
        "Describe how you would handle an at-risk customer after a difficult implementation.",
      signal: "Customer judgment and prioritization",
      source: "job_description",
    },
    {
      durationSeconds: 75,
      id: "communication",
      prompt:
        "Share an example of how you explained a customer issue clearly to another team.",
      signal: "Communication clarity",
      source: "agent",
    },
  ],
  rationale:
    "Prelude prepared four focused questions for first-screen customer success evidence.",
};
