import { describe, expect, it } from "vitest";

import {
  interviewPlanSchema,
  interviewQuestionSourceSchema,
  liveInterviewQuestionCategorySchema,
} from "@prelude/contracts";

import {
  getInterviewPlanPublicationIssues,
  planReferencesDisallowedTopic,
} from "../../domain/interview-plan-policy";
import type { InterviewGenerationTelemetrySink } from "./interview-generation-telemetry";
import {
  buildQuestionEditRationale,
  createDeterministicInterviewDraftGenerator,
  createInterviewDraftGeneratorFromEnv,
  createOpenAIInterviewDraftGenerator,
  deterministicGeneratorProvider,
  interviewQuestionJsonSchema,
  type InterviewDraftGenerationInput,
} from "./interview-draft-generation";

function captureTelemetry() {
  const events: Array<Record<string, unknown>> = [];
  const telemetry: InterviewGenerationTelemetrySink = {
    info: (payload) => events.push(payload),
    warn: (payload) => events.push(payload),
  };
  return { events, telemetry };
}

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

    for (const question of draft.questions) {
      expect(question.expectedSignal.length).toBeGreaterThan(0);
      expect(question.required).toBe(true);
      expect(question.maxFollowups).toBe(1);
      expect(typeof question.category).toBe("string");
    }
  });

  it("authors a non-telegraphing follow-up prompt for every question", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(input());

    for (const question of draft.questions) {
      // Every published question carries a bounded follow-up the live agent can
      // speak verbatim — so the live path never has to synthesize one blindly.
      expect(question.followUpPrompt?.length ?? 0).toBeGreaterThanOrEqual(8);
      // It must elicit, never telegraph: the follow-up never restates the
      // recruiter's expected signal.
      expect(question.followUpPrompt).not.toBe(question.expectedSignal);
      expect(
        question.followUpPrompt
          ?.toLowerCase()
          .includes(question.expectedSignal.toLowerCase()),
      ).toBe(false);
    }
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
    for (const question of draft.questions) {
      expect(question.required).toBe(true);
      expect(question.maxFollowups).toBe(1);
      expect(question.expectedSignal.length).toBeGreaterThan(0);
    }

    const requestBody = JSON.parse(calls[0]?.body ?? "{}");

    expect(requestBody).toMatchObject({
      model: "gpt-test",
      store: false,
    });
    expect(requestBody.text.format.strict).toBe(true);
    // The OpenAI schema must request the Hybrid fields.
    const schemaJson = JSON.stringify(requestBody.text.format.schema);
    expect(schemaJson).toContain("expectedSignal");
    expect(schemaJson).toContain("required");
    expect(schemaJson).toContain("maxFollowups");
    expect(schemaJson).toContain("category");
    expect(schemaJson).toContain("followUpPrompt");
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
            expectedSignal: "Age",
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
    expect(draft.rationale).toContain("HireCall prepared 4 focused");
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
              { id: "bad", prompt: "", expectedSignal: "", source: "agent" },
              {
                durationSeconds: 60,
                id: "unsafe",
                prompt: "How old are you?",
                expectedSignal: "Age",
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
    expect(draft.rationale).toContain("HireCall prepared 4 focused");
  });

  it("reports the openai provider in provenance when generation succeeds", async () => {
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({ output_text: JSON.stringify(sampleDraft) }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      model: "gpt-test",
      timeoutMs: 1000,
    });

    const result = await generator.generateDraftWithProvenance(input());

    expect(result.provider).toBe("openai_responses");
    expect(result.modelName).toBe("gpt-test");
    expect(result.draft.questions).toHaveLength(4);
  });

  it("reports deterministic provenance and warns when OpenAI fails", async () => {
    const { events, telemetry } = captureTelemetry();
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({}),
        ok: false,
        status: 500,
        text: async () => "server error",
      }),
      model: "gpt-test",
      telemetry,
      timeoutMs: 1000,
    });

    const result = await generator.generateDraftWithProvenance(input());

    expect(result.provider).toBe(deterministicGeneratorProvider);
    expect(result.draft.questions).toHaveLength(4);
    const fallback = events.find(
      (event) => event.event === "ai_draft_fallback",
    );
    expect(fallback).toMatchObject({
      event: "ai_draft_fallback",
      provider: "openai_responses",
      reason: "openai_error",
    });
  });

  it("exposes deterministic provenance from the deterministic generator", async () => {
    const generator = createDeterministicInterviewDraftGenerator();

    const result = await generator.generateDraftWithProvenance(input());

    expect(result.provider).toBe(deterministicGeneratorProvider);
    expect(result.draft.questions.length).toBeGreaterThanOrEqual(3);
  });

  it("warns when the keyword policy filter drops generated items", async () => {
    const { events, telemetry } = captureTelemetry();
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            ...sampleDraft,
            criteria: [
              ...sampleDraft.criteria,
              {
                description: "Create a fit score.",
                id: "unsafe-criterion",
                label: "Ranking",
              },
            ],
            questions: [
              ...sampleDraft.questions,
              {
                category: "custom",
                durationSeconds: 60,
                id: "unsafe-question",
                maxFollowups: 1,
                prompt: "How old are you, and what is your date of birth?",
                expectedSignal: "Candidate age and birth date",
                required: true,
                source: "agent",
              },
            ],
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      model: "gpt-test",
      telemetry,
      timeoutMs: 1000,
    });

    await generator.generateDraft(input());

    const dropped = events.find(
      (event) => event.event === "policy_violation_dropped",
    );
    expect(dropped).toBeDefined();
    expect(Number(dropped?.droppedQuestions)).toBeGreaterThanOrEqual(1);
    expect(Number(dropped?.droppedCriteria)).toBeGreaterThanOrEqual(1);
  });

  it("keeps a model-authored follow-up prompt on the generated question", async () => {
    const authored =
      "What did you personally decide, and what changed afterward?";
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            ...sampleDraft,
            questions: [
              { ...sampleDraft.questions[0], followUpPrompt: authored },
              ...sampleDraft.questions.slice(1),
            ],
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
    const match = draft.questions.find((question) => question.id === "motivation");

    expect(match?.followUpPrompt).toBe(authored);
  });

  it("drops a generated question whose follow-up smuggles a protected topic", async () => {
    const { events, telemetry } = captureTelemetry();
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({
          output_text: JSON.stringify({
            ...sampleDraft,
            questions: [
              ...sampleDraft.questions,
              {
                category: "experience",
                durationSeconds: 75,
                id: "smuggled",
                maxFollowups: 1,
                prompt: "Tell us about a project you delivered recently.",
                expectedSignal: "Relevant delivery evidence",
                followUpPrompt: "And what is your date of birth?",
                required: true,
                source: "agent",
              },
            ],
          }),
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      model: "gpt-test",
      telemetry,
      timeoutMs: 1000,
    });

    const draft = await generator.generateDraft(input());
    const content = JSON.stringify(draft).toLowerCase();

    // The clean prompt/signal must not be enough to ship a protected follow-up.
    expect(content).not.toContain("date of birth");
    const dropped = events.find(
      (event) => event.event === "policy_violation_dropped",
    );
    expect(Number(dropped?.droppedQuestions)).toBeGreaterThanOrEqual(1);
  });
});

// Plan 2026-08-18, rules 1, 3 and 5. Two independent language facts reach the
// generator: the INTERVIEW language (questions, criteria, guardrails — read by
// the candidate) and the WORKSPACE language (rationale — builder copy read by
// the recruiter). The deterministic generator is the production fallback, so it
// must honour both without an LLM.
describe("interview draft generation language", () => {
  it("writes every field in English when both languages are en", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(
      input({ interviewLanguage: "en", workspaceLanguage: "en" }),
    );

    expect(draft.guardrails).toContain(
      "Ask every candidate the same questions in the same order.",
    );
    expect(draft.rationale).toContain("HireCall prepared");
    expect(
      draft.questions.some((question) => question.prompt.includes("Tell us")),
    ).toBe(true);
  });

  it("writes every field in French when both languages are fr", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(
      input({ interviewLanguage: "fr", workspaceLanguage: "fr" }),
    );

    expect(draft.guardrails).toContain(
      "Poser à chaque candidat les mêmes questions, dans le même ordre.",
    );
    expect(draft.rationale).toContain("HireCall a préparé");
    expect(
      draft.questions.every((question) => question.followUpPrompt?.length),
    ).toBe(true);
    expect(
      draft.questions.some((question) =>
        question.prompt.startsWith("Parlez-nous"),
      ),
    ).toBe(true);
    expect(
      draft.criteria.some((criterion) =>
        criterion.description.includes("fiche de poste"),
      ),
    ).toBe(true);
    // Follow-ups are candidate-facing too: they must not stay English.
    expect(
      draft.questions.every(
        (question) => !/^(Walk me|Can you|What specifically)/u.test(question.followUpPrompt ?? ""),
      ),
    ).toBe(true);
  });

  it("keeps candidate-bound copy French while the rationale follows an English workspace", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(
      input({ interviewLanguage: "fr", workspaceLanguage: "en" }),
    );

    expect(draft.guardrails).toContain(
      "Poser à chaque candidat les mêmes questions, dans le même ordre.",
    );
    expect(draft.rationale).toContain("HireCall prepared");
  });

  it("keeps candidate-bound copy English while the rationale follows a French workspace", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const draft = await generator.generateDraft(
      input({ interviewLanguage: "en", workspaceLanguage: "fr" }),
    );

    expect(draft.guardrails).toContain(
      "Ask every candidate the same questions in the same order.",
    );
    expect(draft.rationale).toContain("HireCall a préparé");
  });

  it("keeps the deterministic fallback French when the OpenAI call fails", async () => {
    const { events, telemetry } = captureTelemetry();
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async () => ({
        json: async () => ({}),
        ok: false,
        status: 500,
        text: async () => "server error",
      }),
      model: "gpt-test",
      telemetry,
      timeoutMs: 1000,
    });

    const draft = await generator.generateDraft(
      input({ interviewLanguage: "fr", workspaceLanguage: "en" }),
    );

    expect(draft.guardrails).toContain(
      "Poser à chaque candidat les mêmes questions, dans le même ordre.",
    );
    expect(draft.rationale).toContain("HireCall prepared");
    // The fallback event carries the language pair: "AI was unavailable" and
    // "which language did the templates answer in" are the two things an audit
    // of a French workspace needs together.
    expect(
      events.find((event) => event.event === "ai_draft_fallback"),
    ).toMatchObject({
      interviewLanguage: "fr",
      workspaceLanguage: "en",
    });
  });

  it("keeps the deterministic add/refine safety nets in the interview language", async () => {
    const generator = createDeterministicInterviewDraftGenerator();
    const frenchInput = input({
      interviewLanguage: "fr",
      workspaceLanguage: "fr",
    });
    const draft = await generator.generateDraft(frenchInput);

    const added = await generator.addQuestion({
      ...frenchInput,
      draft,
      topic: "mobility",
    });
    const refined = await generator.refineQuestion({
      ...frenchInput,
      action: "sharper",
      draft,
      question: draft.questions[0]!,
    });

    expect(added.prompt).toContain("disponibilité");
    expect(refined.prompt).toContain("Merci de préciser la situation");
  });

  // The gates a French draft has to clear are written against English strings
  // (the keyword policy, the guardrail catalogue, the plan contract). A French
  // draft that generates cleanly but cannot be saved or published is worse than
  // no French at all, so the whole chain is asserted per role domain.
  it("produces French drafts that clear the save contract and the publication gate", async () => {
    const roleTitles = [
      "Customer Success Manager",
      "Directeur Marketing",
      "Coordinateur logistique",
      "Responsable RH",
      "Acheteur",
      "Responsable de salle",
      "AI Orchestrator",
    ];
    const roleBrief =
      "Nous recrutons pour accompagner les clients, coordonner les équipes support et produit, gérer les fournisseurs et la logistique, et communiquer clairement pendant tout le processus.";

    for (const roleTitle of roleTitles) {
      const draft = await createDeterministicInterviewDraftGenerator().generateDraft(
        input({
          interviewLanguage: "fr",
          roleBrief,
          roleTitle,
          seniority: "senior",
          workspaceLanguage: "fr",
        }),
      );

      expect(planReferencesDisallowedTopic(draft), roleTitle).toBe(false);

      const plan = {
        criteria: draft.criteria,
        estimatedMinutes: draft.estimatedMinutes,
        focus: ["role_skills"],
        guardrails: draft.guardrails,
        questions: draft.questions,
        rationale: draft.rationale,
        responseModes: ["audio", "text"] as const,
        roleBrief,
        roleTitle,
        seniority: "senior",
      };

      expect(interviewPlanSchema.safeParse(plan).success, roleTitle).toBe(true);
      expect(
        getInterviewPlanPublicationIssues({
          criteria: plan.criteria,
          guardrails: plan.guardrails,
          questions: plan.questions,
          responseModes: [...plan.responseModes],
          roleBrief,
          roleTitle,
        }),
        roleTitle,
      ).toEqual([]);
    }
  });

  it("instructs the model to write values in the interview language", async () => {
    const calls: string[] = [];
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push(init.body);
        return {
          json: async () => ({ output_text: JSON.stringify(sampleDraft) }),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });

    await generator.generateDraft(
      input({ interviewLanguage: "fr", workspaceLanguage: "fr" }),
    );

    const systemInstructions = JSON.parse(calls[0] ?? "{}").input[0]
      .content as string;

    // Rule 3: the instruction itself stays in English, only the OUTPUT is
    // localized, and the model is never asked to emit the language back.
    expect(systemInstructions).toContain("Write every value in French");
    // The schema half of rule 3, pinned literally: keys and enums are contract
    // surface, and the model must never report the language back — the server
    // already knows it and is the one that stamps it.
    expect(systemInstructions).toContain(
      "Keep the JSON keys and the category and source enum values exactly as specified in English, and never add a language field.",
    );
    expect(systemInstructions).not.toContain('"language"');
    // Same language on both sides: the directive must not split into an
    // awkward per-field instruction.
    expect(systemInstructions).not.toContain("write the rationale");
    // Recency guard: the compliance block is unavoidably English and is the
    // longest run of text in the prompt, so the LAST thing the model reads must
    // be the language, not English policy prose.
    expect(systemInstructions.endsWith("Reminder: write every value in French.")).toBe(
      true,
    );
  });

  it("splits the directive when the rationale language differs from the interview language", async () => {
    const calls: string[] = [];
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push(init.body);
        return {
          json: async () => ({ output_text: JSON.stringify(sampleDraft) }),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });

    await generator.generateDraft(
      input({ interviewLanguage: "fr", workspaceLanguage: "en" }),
    );

    const systemInstructions = JSON.parse(calls[0] ?? "{}").input[0]
      .content as string;

    expect(systemInstructions).toContain(
      "Write the questions, criteria, and guardrails in French",
    );
    expect(systemInstructions).toContain("write the rationale in English");
    // The schema rule is not a property of the collapsed form: it must survive
    // the split directive too.
    expect(systemInstructions).toContain(
      "Keep the JSON keys and the category and source enum values exactly as specified in English, and never add a language field.",
    );
    expect(
      systemInstructions.endsWith(
        "Reminder: write the questions, criteria, and guardrails in French, and the rationale in English.",
      ),
    ).toBe(true);
  });

  it("re-anchors the language after the compliance block in the question prompt", async () => {
    const calls: string[] = [];
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push(init.body);
        return {
          json: async () => ({ output_text: JSON.stringify(sampleDraft.questions[0]) }),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });
    const frenchInput = input({
      interviewLanguage: "fr",
      workspaceLanguage: "fr",
    });
    const draft = await createDeterministicInterviewDraftGenerator().generateDraft(
      frenchInput,
    );

    await generator.addQuestion({ ...frenchInput, draft, topic: "mobility" });

    const systemInstructions = JSON.parse(calls[0] ?? "{}").input[0]
      .content as string;

    // One question is candidate-bound only, so the reminder stays collapsed.
    expect(
      systemInstructions.endsWith("Reminder: write every value in French."),
    ).toBe(true);
  });

  it("re-anchors in English when that is the resolved language", async () => {
    const calls: string[] = [];
    const generator = createOpenAIInterviewDraftGenerator({
      apiKey: "sk-test",
      fetcher: async (_url, init) => {
        calls.push(init.body);
        return {
          json: async () => ({ output_text: JSON.stringify(sampleDraft) }),
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
      model: "gpt-test",
      timeoutMs: 1000,
    });

    await generator.generateDraft(input());

    const systemInstructions = JSON.parse(calls[0] ?? "{}").input[0]
      .content as string;

    expect(
      systemInstructions.endsWith("Reminder: write every value in English."),
    ).toBe(true);
  });
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
    responseModes: ["text", "audio"],
    roleBrief:
      "We are hiring a Customer Success Manager to onboard SMB customers, reduce churn risk, coordinate with product teams, and turn customer feedback into practical improvements.",
    roleTitle: "Customer Success Manager",
    seniority: "mid",
    workspaceLanguage: "en",
    ...overrides,
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
      category: "motivation",
      durationSeconds: 75,
      id: "motivation",
      maxFollowups: 1,
      prompt:
        "What made this Customer Success Manager role interesting to you?",
      expectedSignal: "Role motivation and clarity of expectations",
      required: true,
      source: "agent",
    },
    {
      category: "skills",
      durationSeconds: 90,
      id: "onboarding",
      maxFollowups: 1,
      prompt:
        "Tell us about a customer onboarding project you handled and what changed because of your work.",
      expectedSignal: "Relevant customer onboarding evidence",
      required: true,
      source: "job_description",
    },
    {
      category: "experience",
      durationSeconds: 90,
      id: "judgment",
      maxFollowups: 1,
      prompt:
        "Describe how you would handle an at-risk customer after a difficult implementation.",
      expectedSignal: "Customer judgment and prioritization",
      required: true,
      source: "job_description",
    },
    {
      category: "custom",
      durationSeconds: 75,
      id: "communication",
      maxFollowups: 1,
      prompt:
        "Share an example of how you explained a customer issue clearly to another team.",
      expectedSignal: "Communication clarity",
      required: true,
      source: "agent",
    },
  ],
  rationale:
    "HireCall prepared four focused questions for first-screen customer success evidence.",
};

// N10.D — the OpenAI structured-output json_schema enums must stay in lockstep
// with the canonical Zod enums. If someone adds a category/source to one without
// the other, the model could emit a value the contract rejects (or vice versa);
// this pins the two together so the drift fails CI.
describe("N10 interviewQuestionJsonSchema enums match the Zod contract", () => {
  it("category enum members equal the live interview category enum", () => {
    const jsonCategories = [...interviewQuestionJsonSchema.properties.category.enum].sort();
    const zodCategories = [...liveInterviewQuestionCategorySchema.options].sort();

    expect(jsonCategories).toEqual(zodCategories);
  });

  it("source enum members equal the interview question source enum", () => {
    const jsonSources = [...interviewQuestionJsonSchema.properties.source.enum].sort();
    const zodSources = [...interviewQuestionSourceSchema.options].sort();

    expect(jsonSources).toEqual(zodSources);
  });
});

// The agent bubble in the builder renders `draft.rationale` verbatim, and the
// next save persists it — so every path that rewrites it, including the purely
// client-side removal, is recruiter-bound copy in the WORKSPACE language.
describe("single-question edit rationale", () => {
  it("describes a removal without claiming HireCall authored the remainder", () => {
    // Reusing the "added" sentence here would assert that HireCall prepared
    // exactly these questions, right after the recruiter deleted one.
    expect(
      buildQuestionEditRationale({
        change: "removed",
        questionCount: 3,
        workspaceLanguage: "en",
      }),
    ).toBe(
      "HireCall kept this role screen focused on 3 first-screening questions.",
    );
    expect(
      buildQuestionEditRationale({
        change: "removed",
        questionCount: 3,
        workspaceLanguage: "fr",
      }),
    ).toBe(
      "HireCall garde cet entretien de préqualification centré sur 3 questions.",
    );
  });

  it("agrees in number in both languages", () => {
    expect(
      buildQuestionEditRationale({
        change: "removed",
        questionCount: 1,
        workspaceLanguage: "fr",
      }),
    ).toContain("1 question.");
    expect(
      buildQuestionEditRationale({
        change: "removed",
        questionCount: 1,
        workspaceLanguage: "en",
      }),
    ).toContain("1 first-screening question.");
  });
});
