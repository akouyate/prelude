import type {
  InterviewAgentDraft,
  InterviewCriterionDraft,
  InterviewFocus,
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

import { interviewPlanPolicy } from "../../domain/interview-plan-policy";
import type { InterviewResponseMode } from "./interview-drafts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const interviewDraftPromptVersion = "interview-draft-v1";
export const defaultInterviewDraftLlmModel = "gpt-4.1-mini";

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

export type InterviewDraftGenerator = {
  addQuestion: (
    input: InterviewQuestionAdditionInput,
  ) => Promise<InterviewQuestionDraft>;
  generateDraft: (
    input: InterviewDraftGenerationInput,
  ) => Promise<InterviewAgentDraft>;
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
  timeoutMs,
}: OpenAIInterviewDraftGeneratorOptions): InterviewDraftGenerator {
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
    generateDraft: async (input) => {
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

        return normalizeDraft(payload, input);
      } catch {
        return createDeterministicInterviewDraftGenerator().generateDraft(input);
      }
    },
    modelName: model,
    provider: "openai_responses",
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
          topic: input.question.signal,
        });
      }

      return sharpenQuestion(input.question);
    },
  };
}

export function createDeterministicInterviewDraftGenerator(): InterviewDraftGenerator {
  return {
    addQuestion: async (input) =>
      createDeterministicQuestion({
        index: input.draft.questions.length + 1,
        topic: input.topic,
      }),
    generateDraft: async (input) => {
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
    },
    modelName: interviewDraftPromptVersion,
    provider: "deterministic_test_generator",
    refineQuestion: async (input) => {
      if (input.action === "replace") {
        return createDeterministicQuestion({
          index:
            input.draft.questions.findIndex(
              (question) => question.id === input.question.id,
            ) + 1 || 1,
          topic: input.question.signal,
        });
      }

      return sharpenQuestion(input.question);
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
    "Do not ask about protected traits, appearance, accent, tone, emotion, personality, or biometric attributes.",
    "Do not introduce hire/reject/ranking language.",
    buildAiCompliancePromptContext(),
  ].join(" ");
}

function normalizeDraft(
  value: unknown,
  input: InterviewDraftGenerationInput,
): InterviewAgentDraft {
  if (!isRecord(value)) {
    throw new Error("Role draft generation returned an invalid payload.");
  }

  const targetCount = resolveTargetQuestionCount(input);
  const questions = readArray(value.questions)
    .map((question, index) =>
      safeNormalizeQuestion(question, {
        fallbackId: `q-${index + 1}`,
        fallbackSource: "agent",
      }),
    )
    .filter((question): question is InterviewQuestionDraft => Boolean(question))
    .filter((question) => !questionViolatesPolicy(question))
    .slice(0, targetCount);
  const criteria = readArray(value.criteria)
    .map((criterion, index) =>
      safeNormalizeCriterion(criterion, `criterion-${index + 1}`),
    )
    .filter((criterion): criterion is InterviewCriterionDraft => Boolean(criterion))
    .filter((criterion) => !criterionViolatesPolicy(criterion))
    .slice(0, interviewPlanPolicy.maxCriteria);
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
    questions: filledQuestions,
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

  return {
    durationSeconds: clampNumber(value.durationSeconds, 45, 150, 75),
    id: readString(value.id) || fallbackId,
    prompt,
    signal: readString(value.signal) || "Job-related screening signal",
    source: readQuestionSource(value.source) ?? fallbackSource,
  };
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
      durationSeconds: 60,
      id: `ai-location-${index}`,
      prompt:
        "What availability, location, or work setup constraints should the recruiter know before a next call?",
      signal: "Availability and work setup alignment",
      source: "agent",
    };
  }

  if (normalizedTopic.includes("communication")) {
    return {
      durationSeconds: 75,
      id: `ai-communication-${index}`,
      prompt:
        "Share one example of how you explained a complex customer or internal issue clearly to another person.",
      signal: "Communication clarity in a realistic work situation",
      source: "agent",
    };
  }

  if (normalizedTopic.includes("motivation")) {
    return {
      durationSeconds: 75,
      id: `ai-motivation-${index}`,
      prompt:
        "What made this role stand out to you, and what would make it a strong next step?",
      signal: "Role motivation and expectations",
      source: "agent",
    };
  }

  return {
    durationSeconds: 75,
    id: `ai-signal-${index}`,
    prompt:
      "Tell us about one recent work situation that best shows how you would succeed in this role.",
    signal: "Relevant role evidence",
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
  const questionText = questions.map((question) => question.signal).join(" ");
  const missing = focus.find(
    (item) => !questionText.toLowerCase().includes(item.replace("_", " ")),
  );

  return missing ?? "screening fit";
}

function questionViolatesPolicy(question: InterviewQuestionDraft) {
  return textViolatesPolicy(`${question.prompt} ${question.signal}`);
}

function criterionViolatesPolicy(criterion: InterviewCriterionDraft) {
  return textViolatesPolicy(`${criterion.label} ${criterion.description}`);
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

const interviewQuestionJsonSchema = {
  additionalProperties: false,
  properties: {
    durationSeconds: { type: "number" },
    id: { type: "string" },
    prompt: { type: "string" },
    signal: { type: "string" },
    source: {
      enum: ["job_description", "attachment", "agent"],
      type: "string",
    },
  },
  required: ["id", "prompt", "signal", "source", "durationSeconds"],
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
