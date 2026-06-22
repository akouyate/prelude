import type {
  InterviewAgentDraft,
  InterviewCriterionDraft,
  InterviewFocus,
  InterviewQuestionCategory,
  InterviewQuestionDraft,
  InterviewSeniority,
} from "@prelude/core";
import {
  aiGuardrails,
  buildAiCompliancePromptContext,
  generateDeterministicInterviewDraft,
  resolveTargetInterviewQuestionCount,
  textViolatesPolicy,
} from "@prelude/core";
import { interviewPlanQuestionSchema } from "@prelude/contracts";

import { interviewPlanPolicy } from "../../domain/interview-plan-policy";
import {
  logInterviewGenerationEvent,
  type InterviewGenerationFallbackReason,
  type InterviewGenerationTelemetrySink,
} from "./interview-generation-telemetry";
import type { InterviewResponseMode } from "./interview-drafts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const interviewDraftPromptVersion = "interview-draft-v1";
export const defaultInterviewDraftLlmModel = "gpt-4.1-mini";
// Provenance label persisted when a draft is produced by Prelude's built-in
// deterministic templates (either the deterministic generator, or the OpenAI
// generator after an AI->deterministic fallback). Mirrors the candidate-brief
// modelProvider convention.
export const openAiGeneratorProvider = "openai_responses";
export const deterministicGeneratorProvider = "deterministic";

type FetchResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type Fetcher = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

export type InterviewDraftGenerationInput = {
  companyName: string;
  focus: InterviewFocus[];
  responseModes: InterviewResponseMode[];
  roleBrief: string;
  roleTitle: string;
  seniority: InterviewSeniority;
  sourceAttachmentName?: string;
};

export type InterviewQuestionRefinementInput = InterviewDraftGenerationInput & {
  action: "sharper" | "replace";
  draft: InterviewAgentDraft;
  question: InterviewQuestionDraft;
};

export type InterviewQuestionAdditionInput = InterviewDraftGenerationInput & {
  draft: InterviewAgentDraft;
  topic: string;
};

export type InterviewDraftProvenance = {
  draft: InterviewAgentDraft;
  modelName: string;
  provider: string;
};

export type InterviewDraftGenerator = {
  addQuestion: (
    input: InterviewQuestionAdditionInput,
  ) => Promise<InterviewQuestionDraft>;
  generateDraft: (
    input: InterviewDraftGenerationInput,
  ) => Promise<InterviewAgentDraft>;
  /**
   * N9: returns the draft together with the provenance of the engine that
   * actually produced it. For the OpenAI generator this reflects whether the
   * request fell back to the deterministic templates, which `provider` (a
   * static label) cannot express.
   */
  generateDraftWithProvenance: (
    input: InterviewDraftGenerationInput,
  ) => Promise<InterviewDraftProvenance>;
  modelName: string;
  provider: string;
  refineQuestion: (
    input: InterviewQuestionRefinementInput,
  ) => Promise<InterviewQuestionDraft>;
};

export type OpenAIInterviewDraftGeneratorOptions = {
  apiKey: string;
  fetcher?: Fetcher;
  model: string;
  telemetry?: InterviewGenerationTelemetrySink;
  timeoutMs: number;
};

export function createInterviewDraftGeneratorFromEnv(
  source: Record<string, string | undefined> = process.env,
): InterviewDraftGenerator {
  const mode = source.INTERVIEW_DRAFT_GENERATOR;

  if (mode === "deterministic" || source.NODE_ENV === "test") {
    return createDeterministicInterviewDraftGenerator();
  }

  if (mode && mode !== "openai") {
    return source.NODE_ENV === "production"
      ? createUnavailableInterviewDraftGenerator()
      : createDeterministicInterviewDraftGenerator();
  }

  if (!source.OPENAI_API_KEY && source.NODE_ENV === "production") {
    return createUnavailableInterviewDraftGenerator();
  }

  if (!source.OPENAI_API_KEY) {
    return createDeterministicInterviewDraftGenerator();
  }

  return createOpenAIInterviewDraftGenerator({
    apiKey: source.OPENAI_API_KEY,
    model: source.INTERVIEW_DRAFT_LLM_MODEL ?? defaultInterviewDraftLlmModel,
    timeoutMs: toTimeoutMs(source.INTERVIEW_DRAFT_LLM_TIMEOUT_SECONDS),
  });
}

export function createOpenAIInterviewDraftGenerator({
  apiKey,
  fetcher = defaultFetcher,
  model,
  telemetry,
  timeoutMs,
}: OpenAIInterviewDraftGeneratorOptions): InterviewDraftGenerator {
  const generateDraftWithProvenance = async (
    input: InterviewDraftGenerationInput,
  ): Promise<InterviewDraftProvenance> => {
    let reason: InterviewGenerationFallbackReason = "openai_error";

    try {
      const payload = await createOpenAICompletion({
        apiKey,
        fetcher,
        input: buildDraftPromptInput(input),
        model,
        schema: interviewDraftJsonSchema,
        schemaName: "interview_draft",
        systemInstructions: openAIDraftInstructions(),
        timeoutMs,
      });

      reason = "openai_incomplete_payload";

      return {
        draft: normalizeDraft(payload, input, telemetry),
        modelName: model,
        provider: openAiGeneratorProvider,
      };
    } catch {
      // N9: the AI request (or its normalization) failed; record the
      // AI->deterministic fallback so the recruiter notice and audit log can
      // both reflect that AI tailoring was unavailable.
      logInterviewGenerationEvent(
        {
          event: "ai_draft_fallback",
          model,
          provider: openAiGeneratorProvider,
          reason,
        },
        telemetry,
      );

      return {
        draft: await createDeterministicInterviewDraftGenerator().generateDraft(
          input,
        ),
        modelName: interviewDraftPromptVersion,
        provider: deterministicGeneratorProvider,
      };
    }
  };

  return {
    addQuestion: async (input) => {
      try {
        const payload = await createOpenAICompletion({
          apiKey,
          fetcher,
          input: buildQuestionPromptInput(input, "add_question"),
          model,
          schema: interviewQuestionJsonSchema,
          schemaName: "interview_question",
          systemInstructions: openAIQuestionInstructions(),
          timeoutMs,
        });

        const question = normalizeQuestion(payload, {
          fallbackId: `q-${input.draft.questions.length + 1}`,
          fallbackSource: "agent",
        });

        if (!questionViolatesPolicy(question)) {
          return question;
        }
      } catch {
        // Fall through to the deterministic safety net used by CI and local tests.
      }

      return createDeterministicQuestion({
        index: input.draft.questions.length + 1,
        topic: input.topic,
      });
    },
    generateDraft: async (input) =>
      (await generateDraftWithProvenance(input)).draft,
    generateDraftWithProvenance,
    modelName: model,
    provider: openAiGeneratorProvider,
    refineQuestion: async (input) => {
      try {
        const payload = await createOpenAICompletion({
          apiKey,
          fetcher,
          input: buildQuestionPromptInput(input, "refine_question"),
          model,
          schema: interviewQuestionJsonSchema,
          schemaName: "interview_question",
          systemInstructions: openAIQuestionInstructions(),
          timeoutMs,
        });

        const question = normalizeQuestion(payload, {
          fallbackId: input.question.id,
          fallbackSource: input.question.source,
        });

        if (!questionViolatesPolicy(question)) {
          return question;
        }
      } catch {
        // Fall through to the deterministic safety net used by CI and local tests.
      }

      if (input.action === "replace") {
        return createDeterministicQuestion({
          index: resolveQuestionIndex(input.draft, input.question.id),
          topic: input.question.expectedSignal,
        });
      }

      return sharpenQuestion(input.question);
    },
  };
}

export function createDeterministicInterviewDraftGenerator(): InterviewDraftGenerator {
  const generateDraft = async (input: InterviewDraftGenerationInput) => {
    const draft = generateDeterministicInterviewDraft({
      attachmentName: input.sourceAttachmentName,
      companyName: input.companyName,
      focus: input.focus,
      jobDescription: input.roleBrief,
      jobTitle: input.roleTitle,
      seniority: input.seniority,
    });
    const targetCount = resolveTargetQuestionCount(input);
    const questions = [...draft.questions];

    while (
      questions.length < targetCount &&
      questions.length < interviewPlanPolicy.maxQuestions
    ) {
      const next = createDeterministicQuestion({
        index: questions.length + 1,
        topic: missingFocusTopic(input.focus, questions),
      });
      questions.push(next);
    }

    return normalizeDraft(
      {
        ...draft,
        questions,
        rationale: `Prelude prepared ${questions.length} focused first-screening questions from the role brief, seniority, and selected hiring signals.`,
      },
      input,
    );
  };

  return {
    addQuestion: async (input) =>
      ensureFollowUpPrompt(
        createDeterministicQuestion({
          index: input.draft.questions.length + 1,
          topic: input.topic,
        }),
      ),
    generateDraft,
    generateDraftWithProvenance: async (input) => ({
      draft: await generateDraft(input),
      modelName: interviewDraftPromptVersion,
      provider: deterministicGeneratorProvider,
    }),
    modelName: interviewDraftPromptVersion,
    provider: "deterministic_test_generator",
    refineQuestion: async (input) => {
      if (input.action === "replace") {
        return ensureFollowUpPrompt(
          createDeterministicQuestion({
            index:
              input.draft.questions.findIndex(
                (question) => question.id === input.question.id,
              ) + 1 || 1,
            topic: input.question.expectedSignal,
          }),
        );
      }

      return ensureFollowUpPrompt(sharpenQuestion(input.question));
    },
  };
}

function createUnavailableInterviewDraftGenerator(): InterviewDraftGenerator {
  const fail = async () => {
    throw new Error(
      "Role draft generation is not configured. Set OPENAI_API_KEY or INTERVIEW_DRAFT_GENERATOR=deterministic for local tests.",
    );
  };

  return {
    addQuestion: fail,
    generateDraft: fail,
    generateDraftWithProvenance: fail,
    modelName: "unavailable",
    provider: "unavailable",
    refineQuestion: fail,
  };
}

async function createOpenAICompletion({
  apiKey,
  fetcher,
  input,
  model,
  schema,
  schemaName,
  systemInstructions,
  timeoutMs,
}: {
  apiKey: string;
  fetcher: Fetcher;
  input: unknown;
  model: string;
  schema: unknown;
  schemaName: string;
  systemInstructions: string;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(OPENAI_RESPONSES_URL, {
      body: JSON.stringify({
        input: [
          {
            content: systemInstructions,
            role: "system",
          },
          {
            content: JSON.stringify(input, null, 2),
            role: "user",
          },
        ],
        model,
        store: false,
        temperature: 0.2,
        text: {
          format: {
            name: schemaName,
            schema,
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI role draft generation failed with HTTP ${response.status}`);
    }

    return JSON.parse(extractJsonObject(extractOutputText(await response.json())));
  } finally {
    clearTimeout(timeout);
  }
}

function buildDraftPromptInput(input: InterviewDraftGenerationInput) {
  return {
    companyName: input.companyName,
    focus: input.focus,
    maxQuestions: interviewPlanPolicy.maxQuestions,
    minQuestions: interviewPlanPolicy.minQuestionsToPublish,
    promptVersion: interviewDraftPromptVersion,
    responseModes: input.responseModes,
    roleBrief: input.roleBrief,
    roleTitle: input.roleTitle,
    seniority: input.seniority,
    sourceAttachmentName: input.sourceAttachmentName ?? null,
    targetQuestionCount: resolveTargetQuestionCount(input),
  };
}

function buildQuestionPromptInput(
  input: InterviewQuestionAdditionInput | InterviewQuestionRefinementInput,
  task: "add_question" | "refine_question",
) {
  return {
    ...buildDraftPromptInput(input),
    currentDraft: {
      criteria: input.draft.criteria,
      questions: input.draft.questions,
    },
    question:
      "question" in input
        ? {
            action: input.action,
            question: input.question,
          }
        : null,
    task,
    topic: "topic" in input ? input.topic : null,
  };
}

function openAIDraftInstructions() {
  // Source rationale: docs/sources/role-draft-generation.md and docs/sources/compliance-guardrails.md.
  return [
    "You design Prelude.ai first-screen role interviews for recruiters.",
    "Return only JSON that matches the requested schema.",
    "Create a focused first screen, not a full hiring interview.",
    "The recruiter does not choose the question count; use the provided target count.",
    "Ask questions that invite concrete job-related examples, judgment, motivation, and communication signals.",
    "Keep every question short enough for a live voice interview and natural for the candidate.",
    "For each question, set expectedSignal (what a strong answer reveals), required true (every candidate is asked the same verbatim question), maxFollowups 1 (at most one bounded follow-up), and a category from motivation, experience, skills, logistics, availability, compensation, or custom.",
    "For each question, also set followUpPrompt: one short, natural follow-up that draws out the expectedSignal WITHOUT naming it. Make it open and behavioral — ask for a concrete example, the candidate's own role, a decision they made, or the outcome. Do not presuppose the outcome was positive or successful — ask what happened, not how to make it go well. Never state what you are looking for, never use evaluative words like 'strong', 'good', or 'successful', and never reference protected traits.",
    "Do not ask about protected traits, appearance, accent, tone, emotion, personality, or biometric attributes.",
    "Do not frame output as a hire, reject, ranking, or automated decision.",
    "Include evaluation criteria that map to the questions and can be reviewed by a human recruiter.",
    buildAiCompliancePromptContext(),
  ].join(" ");
}

function openAIQuestionInstructions() {
  return [
    "You improve one Prelude.ai first-screen interview question.",
    "Return only JSON for one question.",
    "Keep the question job-related, concise, natural in live voice, and suitable for the same candidate screen.",
    "Set expectedSignal (what a strong answer reveals), required true, maxFollowups 1, and a category from motivation, experience, skills, logistics, availability, compensation, or custom.",
    "Set followUpPrompt: one short, natural follow-up that draws out the expectedSignal WITHOUT naming it — open and behavioral (a concrete example, the candidate's own role, a decision, or the outcome). Do not presuppose the outcome was positive or successful, no evaluative words like 'strong'/'good'/'successful', no protected traits.",
    "Do not ask about protected traits, appearance, accent, tone, emotion, personality, or biometric attributes.",
    "Do not introduce hire/reject/ranking language.",
    buildAiCompliancePromptContext(),
  ].join(" ");
}

function normalizeDraft(
  value: unknown,
  input: InterviewDraftGenerationInput,
  telemetry?: InterviewGenerationTelemetrySink,
): InterviewAgentDraft {
  if (!isRecord(value)) {
    throw new Error("Role draft generation returned an invalid payload.");
  }

  const targetCount = resolveTargetQuestionCount(input);
  // Normalize first, then split out the policy filter so the keyword gate's
  // drops can be counted and reported (N9 telemetry).
  const normalizedQuestions = readArray(value.questions)
    .map((question, index) =>
      safeNormalizeQuestion(question, {
        fallbackId: `q-${index + 1}`,
        fallbackSource: "agent",
      }),
    )
    .filter((question): question is InterviewQuestionDraft => Boolean(question));
  const droppedQuestions = normalizedQuestions.filter((question) =>
    questionViolatesPolicy(question),
  ).length;
  const questions = normalizedQuestions
    .filter((question) => !questionViolatesPolicy(question))
    .slice(0, targetCount);

  const normalizedCriteria = readArray(value.criteria)
    .map((criterion, index) =>
      safeNormalizeCriterion(criterion, `criterion-${index + 1}`),
    )
    .filter((criterion): criterion is InterviewCriterionDraft =>
      Boolean(criterion),
    );
  const droppedCriteria = normalizedCriteria.filter((criterion) =>
    criterionViolatesPolicy(criterion),
  ).length;
  const criteria = normalizedCriteria
    .filter((criterion) => !criterionViolatesPolicy(criterion))
    .slice(0, interviewPlanPolicy.maxCriteria);

  if (droppedQuestions > 0 || droppedCriteria > 0) {
    logInterviewGenerationEvent(
      {
        event: "policy_violation_dropped",
        droppedCriteria,
        droppedQuestions,
      },
      telemetry,
    );
  }

  const fallbackDraft = generateDeterministicInterviewDraft({
    attachmentName: input.sourceAttachmentName,
    companyName: input.companyName,
    focus: input.focus,
    jobDescription: input.roleBrief,
    jobTitle: input.roleTitle,
    seniority: input.seniority,
  });
  const filledQuestions = fillQuestionsToTarget({
    fallbackDraft,
    input,
    questions,
    targetCount,
  });
  const filledCriteria = fillCriteriaToMinimum({
    criteria,
    fallbackDraft,
  });

  if (filledQuestions.length < interviewPlanPolicy.minQuestionsToPublish) {
    throw new Error("Role draft generation returned an incomplete question set.");
  }

  if (filledCriteria.length < interviewPlanPolicy.minCriteriaToPublish) {
    throw new Error("Role draft generation returned an incomplete evaluation matrix.");
  }

  return {
    criteria: filledCriteria,
    estimatedMinutes: normalizeEstimatedMinutes(value.estimatedMinutes, filledQuestions),
    guardrails: normalizeGuardrails(value.guardrails),
    // Every published question carries a bounded, signal-aware follow-up
    // (authored by the model or derived from the category) so the live agent
    // never has to synthesize one blindly — and it was scanned by the policy
    // filter above before reaching here.
    questions: filledQuestions.map(ensureFollowUpPrompt),
    rationale: normalizeRationale(value.rationale, filledQuestions.length, input),
  };
}

function fillQuestionsToTarget({
  fallbackDraft,
  input,
  questions,
  targetCount,
}: {
  fallbackDraft: InterviewAgentDraft;
  input: InterviewDraftGenerationInput;
  questions: InterviewQuestionDraft[];
  targetCount: number;
}) {
  const filled = dedupeById(questions).slice(0, targetCount);

  for (const question of fallbackDraft.questions) {
    if (filled.length >= targetCount) {
      break;
    }

    if (!filled.some((item) => item.id === question.id)) {
      filled.push(question);
    }
  }

  while (
    filled.length < targetCount &&
    filled.length < interviewPlanPolicy.maxQuestions
  ) {
    filled.push(
      createDeterministicQuestion({
        index: filled.length + 1,
        topic: missingFocusTopic(input.focus, filled),
      }),
    );
  }

  return filled.slice(0, interviewPlanPolicy.maxQuestions);
}

function fillCriteriaToMinimum({
  criteria,
  fallbackDraft,
}: {
  criteria: InterviewCriterionDraft[];
  fallbackDraft: InterviewAgentDraft;
}) {
  const filled = dedupeById(criteria).slice(0, interviewPlanPolicy.maxCriteria);

  for (const criterion of fallbackDraft.criteria) {
    if (filled.length >= interviewPlanPolicy.minCriteriaToPublish) {
      break;
    }

    if (!filled.some((item) => item.id === criterion.id)) {
      filled.push(criterion);
    }
  }

  return filled.slice(0, interviewPlanPolicy.maxCriteria);
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function normalizeQuestion(
  value: unknown,
  {
    fallbackId,
    fallbackSource,
  }: {
    fallbackId: string;
    fallbackSource: InterviewQuestionDraft["source"];
  },
): InterviewQuestionDraft {
  if (!isRecord(value)) {
    throw new Error("Role draft generation returned an invalid question.");
  }

  const prompt = readString(value.prompt);

  if (prompt.length < 8) {
    throw new Error("Role draft generation returned an empty question.");
  }

  const source = readQuestionSource(value.source) ?? fallbackSource;
  const expectedSignal =
    readString(value.expectedSignal) ||
    readString(value.signal) ||
    "Job-related screening signal";
  const category =
    readQuestionCategory(value.category) ?? inferCategory(source);
  // A model-authored follow-up shorter than the contract minimum drops to
  // undefined so the question is not rejected; ensureFollowUpPrompt then
  // derives a safe category default.
  const followUpRaw = readString(value.followUpPrompt);
  const followUpPrompt = followUpRaw.length >= 8 ? followUpRaw : undefined;

  const candidate: InterviewQuestionDraft = {
    category,
    durationSeconds: clampNumber(value.durationSeconds, 45, 150, 75),
    expectedSignal,
    followUpPrompt,
    id: readString(value.id) || fallbackId,
    maxFollowups: clampNumber(value.maxFollowups, 0, 1, 1),
    prompt,
    required: typeof value.required === "boolean" ? value.required : true,
    source,
  };

  // Route normalized output through the canonical question contract so the
  // generator can never emit a question that the persisted plan would reject.
  const parsed = interviewPlanQuestionSchema.parse(candidate);

  return {
    category: parsed.category as InterviewQuestionCategory,
    durationSeconds: parsed.durationSeconds,
    expectedSignal: parsed.expectedSignal ?? expectedSignal,
    followUpPrompt: parsed.followUpPrompt,
    id: parsed.id,
    maxFollowups: parsed.maxFollowups,
    prompt: parsed.prompt,
    required: parsed.required,
    source: parsed.source,
  };
}

function inferCategory(
  source: InterviewQuestionDraft["source"],
): InterviewQuestionCategory {
  if (source === "job_description") {
    return "experience";
  }
  if (source === "attachment") {
    return "skills";
  }
  return "custom";
}

function readQuestionCategory(
  value: unknown,
): InterviewQuestionCategory | null {
  const categories: InterviewQuestionCategory[] = [
    "motivation",
    "experience",
    "skills",
    "logistics",
    "availability",
    "compensation",
    "custom",
  ];

  return categories.includes(value as InterviewQuestionCategory)
    ? (value as InterviewQuestionCategory)
    : null;
}

function safeNormalizeQuestion(
  value: unknown,
  fallback: {
    fallbackId: string;
    fallbackSource: InterviewQuestionDraft["source"];
  },
) {
  try {
    return normalizeQuestion(value, fallback);
  } catch {
    return null;
  }
}

function normalizeCriterion(
  value: unknown,
  fallbackId: string,
): InterviewCriterionDraft {
  if (!isRecord(value)) {
    throw new Error("Role draft generation returned an invalid criterion.");
  }

  const label = readString(value.label);

  if (label.length < 2) {
    throw new Error("Role draft generation returned an empty criterion.");
  }

  return {
    description:
      readString(value.description) ||
      "Reviewer should look for concrete, job-related evidence.",
    id: readString(value.id) || fallbackId,
    label,
  };
}

function safeNormalizeCriterion(value: unknown, fallbackId: string) {
  try {
    return normalizeCriterion(value, fallbackId);
  } catch {
    return null;
  }
}

function normalizeRationale(
  value: unknown,
  questionCount: number,
  input: InterviewDraftGenerationInput,
) {
  const rationale = readString(value);

  if (rationale && !textViolatesPolicy(rationale)) {
    return rationale;
  }

  return `Prelude prepared ${questionCount} focused first-screening questions for ${input.roleTitle}.`;
}

function normalizeGuardrails(value: unknown) {
  const generated = readArray(value)
    .map(readString)
    .filter(Boolean);
  const required = ["Ask every candidate the same questions in the same order.", ...aiGuardrails];

  return Array.from(new Set([...generated, ...required])).slice(0, 12);
}

function normalizeEstimatedMinutes(
  value: unknown,
  questions: InterviewQuestionDraft[],
) {
  const fallback = Math.max(
    4,
    Math.round(
      questions.reduce((sum, question) => sum + question.durationSeconds, 0) /
        60,
    ),
  );

  return clampNumber(value, 1, 20, fallback);
}

function resolveTargetQuestionCount(input: InterviewDraftGenerationInput) {
  return resolveTargetInterviewQuestionCount({
    focus: input.focus,
    jobDescription: input.roleBrief,
    jobTitle: input.roleTitle,
    seniority: input.seniority,
  });
}

function createDeterministicQuestion({
  index,
  topic,
}: {
  index: number;
  topic: string;
}): InterviewQuestionDraft {
  const normalizedTopic = topic.trim().toLowerCase();

  if (normalizedTopic.includes("location") || normalizedTopic.includes("mobility")) {
    return {
      category: "logistics",
      durationSeconds: 60,
      expectedSignal: "Availability and work setup alignment",
      id: `ai-location-${index}`,
      maxFollowups: 1,
      prompt:
        "What availability, location, or work setup constraints should the recruiter know before a next call?",
      required: true,
      source: "agent",
    };
  }

  if (normalizedTopic.includes("communication")) {
    return {
      category: "custom",
      durationSeconds: 75,
      expectedSignal: "Communication clarity in a realistic work situation",
      id: `ai-communication-${index}`,
      maxFollowups: 1,
      prompt:
        "Share one example of how you explained a complex customer or internal issue clearly to another person.",
      required: true,
      source: "agent",
    };
  }

  if (normalizedTopic.includes("motivation")) {
    return {
      category: "motivation",
      durationSeconds: 75,
      expectedSignal: "Role motivation and expectations",
      id: `ai-motivation-${index}`,
      maxFollowups: 1,
      prompt:
        "What made this role stand out to you, and what would make it a strong next step?",
      required: true,
      source: "agent",
    };
  }

  return {
    category: "experience",
    durationSeconds: 75,
    expectedSignal: "Relevant role evidence",
    id: `ai-signal-${index}`,
    maxFollowups: 1,
    prompt:
      "Tell us about one recent work situation that best shows how you would succeed in this role.",
    required: true,
    source: "job_description",
  };
}

function sharpenQuestion(question: InterviewQuestionDraft): InterviewQuestionDraft {
  const instruction = "Please include the situation, your action, and the result.";

  if (question.prompt.includes(instruction)) {
    return question;
  }

  return {
    ...question,
    prompt: `${question.prompt} ${instruction}`,
    source: "agent",
  };
}

function resolveQuestionIndex(draft: InterviewAgentDraft, questionId: string) {
  const index = draft.questions.findIndex((question) => question.id === questionId);

  return index >= 0 ? index + 1 : 1;
}

function missingFocusTopic(
  focus: InterviewFocus[],
  questions: InterviewQuestionDraft[],
) {
  const questionText = questions
    .map((question) => question.expectedSignal)
    .join(" ");
  const missing = focus.find(
    (item) => !questionText.toLowerCase().includes(item.replace("_", " ")),
  );

  return missing ?? "screening fit";
}

function questionViolatesPolicy(question: InterviewQuestionDraft) {
  return textViolatesPolicy(
    `${question.prompt} ${question.expectedSignal} ${question.followUpPrompt ?? ""}`,
  );
}

function criterionViolatesPolicy(criterion: InterviewCriterionDraft) {
  return textViolatesPolicy(`${criterion.label} ${criterion.description}`);
}

// Open, behavioral follow-ups keyed by question category. They draw out evidence
// of the recruiter's expected signal WITHOUT telegraphing it — no evaluative
// adjectives, never naming what a strong answer should contain. These are
// hand-authored, compliance-reviewed CONSTANTS: ensureFollowUpPrompt applies
// them after the policy filter, so they are trusted and must never be templated
// with role/candidate text (that would bypass the protected-topic scan).
function deterministicFollowUpPrompt(category: string): string {
  switch (category) {
    case "motivation":
      return "What specifically would make this role the right next step for you?";
    case "experience":
      return "Walk me through what you personally did, and what the outcome was.";
    case "skills":
      return "Can you give a concrete example from your own work?";
    case "logistics":
      return "Is there any practical constraint the recruiter should know now?";
    case "availability":
      return "What timing or availability would you need for the next steps?";
    case "compensation":
      return "What expectations should the recruiter keep in mind for a next conversation?";
    default:
      return "Can you share a specific example, including your role and the result?";
  }
}

function ensureFollowUpPrompt(
  question: InterviewQuestionDraft,
): InterviewQuestionDraft {
  const authored = question.followUpPrompt?.trim();
  if (authored && authored.length >= 8) {
    return { ...question, followUpPrompt: authored };
  }

  return {
    ...question,
    followUpPrompt: deterministicFollowUpPrompt(question.category),
  };
}

function readQuestionSource(value: unknown): InterviewQuestionDraft["source"] | null {
  if (
    value === "agent" ||
    value === "attachment" ||
    value === "job_description"
  ) {
    return value;
  }

  return null;
}

function extractOutputText(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("OpenAI role draft generation returned no payload");
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const output = payload.output;
  if (Array.isArray(output)) {
    const text = output
      .flatMap((item) =>
        isRecord(item) && Array.isArray(item.content) ? item.content : [],
      )
      .map((content) => {
        if (!isRecord(content)) {
          return "";
        }
        return typeof content.text === "string" ? content.text : "";
      })
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
  }

  throw new Error("OpenAI role draft generation returned no output text");
}

function extractJsonObject(value: string) {
  const stripped = value
    .trim()
    .replace(/^```json\s*/u, "")
    .replace(/^```\s*/u, "")
    .replace(/```\s*$/u, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return stripped.slice(start, end + 1);
  }

  return stripped;
}

async function defaultFetcher(
  url: string,
  init: Parameters<Fetcher>[1],
): Promise<FetchResponse> {
  return fetch(url, init);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  return Math.max(
    min,
    Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTimeoutMs(value: string | undefined) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 12_000;
  }

  return Math.max(2_000, Math.min(30_000, seconds * 1000));
}

// Exported for the N10 contract-lockstep test: the OpenAI structured-output
// json_schema enums must stay identical to the canonical Zod enums (question
// category + source). The test asserts the enum members match so a future edit
// to one without the other fails CI rather than silently drifting.
export const interviewQuestionJsonSchema = {
  additionalProperties: false,
  properties: {
    category: {
      enum: [
        "motivation",
        "experience",
        "skills",
        "logistics",
        "availability",
        "compensation",
        "custom",
      ],
      type: "string",
    },
    durationSeconds: { type: "number" },
    expectedSignal: { type: "string" },
    followUpPrompt: { type: ["string", "null"] },
    id: { type: "string" },
    maxFollowups: { maximum: 1, minimum: 0, type: "integer" },
    prompt: { type: "string" },
    required: { type: "boolean" },
    source: {
      enum: ["job_description", "attachment", "agent"],
      type: "string",
    },
  },
  required: [
    "id",
    "prompt",
    "expectedSignal",
    "followUpPrompt",
    "category",
    "required",
    "maxFollowups",
    "source",
    "durationSeconds",
  ],
  type: "object",
} as const;

const interviewCriterionJsonSchema = {
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    id: { type: "string" },
    label: { type: "string" },
  },
  required: ["id", "label", "description"],
  type: "object",
} as const;

const interviewDraftJsonSchema = {
  additionalProperties: false,
  properties: {
    criteria: {
      items: interviewCriterionJsonSchema,
      type: "array",
    },
    estimatedMinutes: { type: "number" },
    guardrails: {
      items: { type: "string" },
      type: "array",
    },
    questions: {
      items: interviewQuestionJsonSchema,
      type: "array",
    },
    rationale: { type: "string" },
  },
  required: ["questions", "criteria", "estimatedMinutes", "rationale", "guardrails"],
  type: "object",
} as const;
