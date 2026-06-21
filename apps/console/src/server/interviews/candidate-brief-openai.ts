import {
  candidateBriefSchema,
  type CandidateBriefDto,
} from "@prelude/contracts";
import {
  aiCompliancePolicyVersion,
  buildAiCompliancePromptContext,
  defaultComplianceFlags,
  disallowedQuestionTopics,
  recruiterLimitationCopy,
  sensitiveInformationHandlingRule,
} from "@prelude/core";

import type {
  CandidateBriefSynthesizer,
  CandidateBriefSynthesizerInput,
} from "./candidate-brief-generation";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CANDIDATE_BRIEF_PROMPT_VERSION = "candidate-brief-v1";

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

export type OpenAICandidateBriefSynthesizerOptions = {
  apiKey: string;
  fetcher?: Fetcher;
  model: string;
  timeoutMs: number;
};

export function createOpenAICandidateBriefSynthesizer({
  apiKey,
  fetcher = defaultFetcher,
  model,
  timeoutMs,
}: OpenAICandidateBriefSynthesizerOptions): CandidateBriefSynthesizer {
  return {
    modelName: model,
    provider: "openai_responses",
    synthesize: async (input) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetcher(OPENAI_RESPONSES_URL, {
          body: JSON.stringify(buildOpenAIRequestBody({ input, model })),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `OpenAI candidate brief synthesis failed with HTTP ${response.status}`,
          );
        }

        return candidateBriefSchema.parse(
          readCandidateBriefFromOpenAIResponse(await response.json()),
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function buildOpenAIRequestBody({
  input,
  model,
}: {
  input: CandidateBriefSynthesizerInput;
  model: string;
}) {
  return {
    input: [
      {
        content: openAISystemInstructions(),
        role: "system",
      },
      {
        content: JSON.stringify(buildPromptInput(input), null, 2),
        role: "user",
      },
    ],
    model,
    store: false,
    temperature: 0,
    text: {
      format: {
        name: "candidate_brief",
        schema: candidateBriefJsonSchema,
        strict: false,
        type: "json_schema",
      },
    },
  };
}

function buildPromptInput(input: CandidateBriefSynthesizerInput) {
  return {
    candidateLabel: input.candidateLabel,
    candidateSessionId: input.candidateSessionId,
    complianceFlags: defaultComplianceFlags,
    compliancePolicyVersion: aiCompliancePolicyVersion,
    criteria: input.criteria,
    disallowedQuestionAndReviewTopics: disallowedQuestionTopics,
    evidence: {
      questionAnswerSequence: input.evidence.questionAnswerSequence,
      questionCompletionRate: input.evidence.questionCompletionRate,
      transcriptTurns: input.evidence.transcriptTurns,
    },
    jobTitle: input.jobTitle,
    limitations: [recruiterLimitationCopy, sensitiveInformationHandlingRule],
    promptVersion: OPENAI_CANDIDATE_BRIEF_PROMPT_VERSION,
    roleTitle: input.roleTitle,
  };
}

function openAISystemInstructions() {
  // Source rationale: docs/sources/evaluation-matrix.md and docs/sources/compliance-guardrails.md.
  return [
    "You write concise first-screening recruiter briefs for Prelude.ai.",
    "Return only JSON that matches the requested schema.",
    "Use only transcript evidence from the input. Do not invent facts.",
    "Separate facts, inferred job-related signals, risks, missing information, and recruiter next step.",
    "A spoken answer is not valid unless it is relevant, coherent, and job-related.",
    buildAiCompliancePromptContext(),
    "If evidence is absent or weak, mark it as missing, unclear, partial, or risk and recommend recruiter follow-up.",
  ].join(" ");
}

function readCandidateBriefFromOpenAIResponse(payload: unknown): CandidateBriefDto {
  const outputText = extractOutputText(payload);
  const jsonText = extractJsonObject(outputText);

  try {
    return JSON.parse(jsonText) as CandidateBriefDto;
  } catch (error) {
    throw new Error("OpenAI candidate brief synthesis returned invalid JSON", {
      cause: error,
    });
  }
}

function extractOutputText(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("OpenAI candidate brief synthesis returned no payload");
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const output = payload.output;
  if (Array.isArray(output)) {
    const text = output
      .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
      .map((content) => {
        if (!isRecord(content)) {
          return "";
        }
        if (typeof content.text === "string") {
          return content.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
  }

  throw new Error("OpenAI candidate brief synthesis returned no output text");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const evidenceSchema = {
  additionalProperties: false,
  properties: {
    eventId: { type: "string" },
    questionId: { type: "string" },
    text: { type: "string" },
    transcriptTurnId: { type: "string" },
  },
  required: ["text"],
  type: "object",
} as const;

const criterionSchema = {
  additionalProperties: false,
  properties: {
    criterionId: { type: "string" },
    evidence: {
      items: evidenceSchema,
      type: "array",
    },
    label: { type: "string" },
    rationale: { type: "string" },
    status: {
      enum: ["Strong", "Medium", "Weak", "Not assessable"],
      type: "string",
    },
  },
  required: ["criterionId", "label", "status", "rationale", "evidence"],
  type: "object",
} as const;

const matrixCriterionSchema = {
  additionalProperties: false,
  properties: {
    category: {
      enum: [
        "experience",
        "motivation",
        "availability",
        "logistics",
        "communication",
        "role_specific",
      ],
      type: "string",
    },
    confidence: { enum: ["low", "medium", "high"], type: "string" },
    criterionId: { type: "string" },
    evidence: { items: evidenceSchema, type: "array" },
    followUps: { items: { type: "string" }, type: "array" },
    label: { type: "string" },
    missingInfo: { items: { type: "string" }, type: "array" },
    rationale: { type: "string" },
    status: {
      enum: ["satisfied", "partial", "unclear", "missing", "risk"],
      type: "string",
    },
  },
  required: [
    "criterionId",
    "label",
    "category",
    "status",
    "confidence",
    "rationale",
    "evidence",
    "missingInfo",
    "followUps",
  ],
  type: "object",
} as const;

const inferredSignalSchema = {
  additionalProperties: false,
  properties: {
    confidence: { enum: ["low", "medium", "high"], type: "string" },
    evidence: { items: evidenceSchema, type: "array" },
    label: { type: "string" },
  },
  required: ["label", "confidence", "evidence"],
  type: "object",
} as const;

const candidateBriefJsonSchema = {
  additionalProperties: false,
  properties: {
    candidateSessionId: { type: "string" },
    complianceFlags: {
      items: {
        enum: [
          "biometric_scoring_disallowed",
          "human_review_required",
          "job_related_questions_only",
          "protected_traits_excluded",
          "sensitive_signal_review_required",
        ],
        type: "string",
      },
      type: "array",
    },
    criteria: { items: criterionSchema, type: "array" },
    evaluationMatrix: {
      additionalProperties: false,
      properties: {
        criteria: { items: matrixCriterionSchema, type: "array" },
        facts: { items: { type: "string" }, type: "array" },
        inferredSignals: { items: inferredSignalSchema, type: "array" },
        missingInfo: { items: { type: "string" }, type: "array" },
        recommendationConfidence: {
          enum: ["low", "medium", "high"],
          type: "string",
        },
        recommendationLabel: {
          enum: ["continue", "targeted_follow_up", "inconclusive"],
          type: "string",
        },
        recommendationRationale: { type: "string" },
        recommendedNextStep: { enum: ["to_call", "to_review"], type: "string" },
        risks: { items: { type: "string" }, type: "array" },
      },
      required: [
        "criteria",
        "facts",
        "inferredSignals",
        "risks",
        "missingInfo",
        "recommendedNextStep",
        "recommendationLabel",
        "recommendationConfidence",
        "recommendationRationale",
      ],
      type: "object",
    },
    limitations: { items: { type: "string" }, type: "array" },
    pointsToClarify: { items: { type: "string" }, type: "array" },
    risks: { items: { type: "string" }, type: "array" },
    status: { enum: ["completed"], type: "string" },
    strengths: { items: { type: "string" }, type: "array" },
    suggestedNextStep: { enum: ["to_call", "to_review"], type: "string" },
    summary: { type: "string" },
  },
  required: [
    "candidateSessionId",
    "status",
    "summary",
    "strengths",
    "risks",
    "pointsToClarify",
    "criteria",
    "evaluationMatrix",
    "limitations",
    "complianceFlags",
    "suggestedNextStep",
  ],
  type: "object",
} as const;
