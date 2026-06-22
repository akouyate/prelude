import { textViolatesPolicy } from "@prelude/core";
import type { InterviewPlan } from "@prelude/contracts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const draftQualityEvalPromptVersion = "draft-quality-v1";
export const defaultDraftQualityLlmModel = "gpt-4.1-mini";

// Encodes the docs/sources/evaluation-matrix.md quality requirements:
// recruiter-facing screening must be evidence-backed (job-related), elicit
// concrete behavioral evidence, state the signal each question reveals, avoid
// redundant prompts, and exclude protected/biometric attributes from scoring.
export const draftQualityDimensions = [
  "job-relatedness",
  "behavioral-anchoring",
  "signal-clarity",
  "non-redundancy",
  "compliance-safety",
] as const;

export type DraftQualityDimension = (typeof draftQualityDimensions)[number];

// Overall score below which a draft is considered a quality regression. The
// deterministic grader scores a healthy generated draft well above this and a
// deliberately bad one well below, so CI can assert against it without paid
// LLM calls.
export const draftQualityRegressionThreshold = 70;

export type DraftQualityDimensionScore = {
  score: number;
  rationale: string;
};

export type DraftQualityIssue = {
  dimension: DraftQualityDimension | "plan";
  message: string;
};

export type DraftQualityReport = {
  // false when the evaluator is disabled or the LLM judge failed soft.
  available: boolean;
  provider: string;
  modelName: string;
  overallScore: number;
  passed: boolean;
  dimensions: Record<DraftQualityDimension, DraftQualityDimensionScore>;
  issues: DraftQualityIssue[];
};

export type DraftQualityEvaluator = {
  provider: string;
  modelName: string;
  evaluate: (plan: InterviewPlan) => Promise<DraftQualityReport>;
};

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

export type OpenAIDraftQualityEvaluatorOptions = {
  apiKey: string;
  fetcher?: Fetcher;
  model: string;
  timeoutMs: number;
};

export function createDraftQualityEvaluatorFromEnv(
  source: Record<string, string | undefined> = process.env,
): DraftQualityEvaluator {
  const mode = source.DRAFT_QUALITY_EVALUATOR;

  if (mode === "off") {
    return createDisabledDraftQualityEvaluator();
  }

  if (mode === "deterministic" || source.NODE_ENV === "test") {
    return createDeterministicDraftQualityEvaluator();
  }

  // A configured non-"openai" provider must never take this layer offline: it
  // is an additive quality net, so it degrades to deterministic rather than
  // becoming "unavailable".
  if (mode && mode !== "openai") {
    return createDeterministicDraftQualityEvaluator();
  }

  // Missing key degrades to the deterministic heuristic grader even in
  // production — the eval must never block on OpenAI being unconfigured.
  if (!source.OPENAI_API_KEY) {
    return createDeterministicDraftQualityEvaluator();
  }

  return createOpenAIDraftQualityEvaluator({
    apiKey: source.OPENAI_API_KEY,
    model: source.DRAFT_QUALITY_LLM_MODEL ?? defaultDraftQualityLlmModel,
    timeoutMs: toTimeoutMs(source.DRAFT_QUALITY_LLM_TIMEOUT_SECONDS),
  });
}

function createDisabledDraftQualityEvaluator(): DraftQualityEvaluator {
  return {
    evaluate: async () => unavailableReport("disabled", "disabled"),
    modelName: "disabled",
    provider: "disabled",
  };
}

// ---------------------------------------------------------------------------
// Deterministic heuristic grader (no LLM): pure, reproducible scoring of the
// rubric dimensions plus a HARD compliance gate via textViolatesPolicy.
// ---------------------------------------------------------------------------
export function createDeterministicDraftQualityEvaluator(): DraftQualityEvaluator {
  return {
    evaluate: async (plan) => gradePlanDeterministically(plan),
    modelName: draftQualityEvalPromptVersion,
    provider: "deterministic",
  };
}

const BEHAVIORAL_CUES = [
  "tell us about",
  "describe",
  "imagine",
  "share an example",
  "share one example",
  "explain",
  "what would you do",
  "what made",
  "what should",
  "what work setup",
  "how you",
  "a time",
  "a recent",
  "a situation",
  "a project",
  "would you",
];

const GENERIC_PROMPTS = [
  "tell us about yourself",
  "what are your strengths",
  "what are your weaknesses",
  "why should we hire you",
  "where do you see yourself",
];

function gradePlanDeterministically(plan: InterviewPlan): DraftQualityReport {
  const issues: DraftQualityIssue[] = [];

  const compliance = gradeCompliance(plan, issues);
  const jobRelatedness = gradeJobRelatedness(plan, issues);
  const behavioralAnchoring = gradeBehavioralAnchoring(plan, issues);
  const signalClarity = gradeSignalClarity(plan, issues);
  const nonRedundancy = gradeNonRedundancy(plan, issues);

  const dimensions: Record<DraftQualityDimension, DraftQualityDimensionScore> = {
    "job-relatedness": jobRelatedness,
    "behavioral-anchoring": behavioralAnchoring,
    "signal-clarity": signalClarity,
    "non-redundancy": nonRedundancy,
    "compliance-safety": compliance,
  };

  // A compliance failure is disqualifying: cap the overall score so a
  // protected-topic draft can never pass the regression threshold, regardless
  // of how strong the other dimensions look.
  const weighted = Math.round(
    draftQualityDimensions.reduce(
      (sum, dimension) => sum + dimensions[dimension].score,
      0,
    ) / draftQualityDimensions.length,
  );
  const overallScore =
    compliance.score === 0 ? Math.min(weighted, 40) : weighted;
  const passed =
    compliance.score > 0 && overallScore >= draftQualityRegressionThreshold;

  return {
    available: true,
    dimensions,
    issues,
    modelName: draftQualityEvalPromptVersion,
    overallScore,
    passed,
    provider: "deterministic",
  };
}

function gradeCompliance(
  plan: InterviewPlan,
  issues: DraftQualityIssue[],
): DraftQualityDimensionScore {
  const offending: string[] = [];

  for (const question of plan.questions) {
    const text = `${question.prompt} ${question.expectedSignal ?? ""}`;
    if (textViolatesPolicy(text)) {
      offending.push(`question ${question.id}`);
    }
  }

  for (const criterion of plan.criteria) {
    const text = `${criterion.label} ${criterion.description}`;
    if (textViolatesPolicy(text)) {
      offending.push(`criterion ${criterion.id}`);
    }
  }

  if (textViolatesPolicy(plan.rationale)) {
    offending.push("rationale");
  }

  if (offending.length > 0) {
    issues.push({
      dimension: "compliance-safety",
      message: `Protected-topic or automated-decision policy violation in ${offending.join(", ")}.`,
    });

    return {
      rationale: `Hard compliance failure: ${offending.length} segment(s) probe protected attributes or automated decisions.`,
      score: 0,
    };
  }

  return {
    rationale: "No protected attributes, biometric, or automated-decision language detected.",
    score: 100,
  };
}

function gradeJobRelatedness(
  plan: InterviewPlan,
  issues: DraftQualityIssue[],
): DraftQualityDimensionScore {
  const roleTokens = tokenize(`${plan.roleTitle} ${plan.roleBrief}`);
  let related = 0;
  let generic = 0;

  for (const question of plan.questions) {
    const normalized = question.prompt.trim().toLowerCase();
    const isGeneric = GENERIC_PROMPTS.some((generic) =>
      normalized.startsWith(generic),
    );
    const overlaps =
      roleTokens.size === 0 ||
      tokenizeArray(question.prompt).some((token) => roleTokens.has(token)) ||
      question.source === "job_description" ||
      question.source === "attachment" ||
      (question.category !== "custom" && question.category !== "logistics");

    if (isGeneric) {
      generic += 1;
    } else if (overlaps) {
      related += 1;
    }
  }

  const total = plan.questions.length || 1;
  const score = clampScore(Math.round((related / total) * 100) - generic * 20);

  if (score < 60) {
    issues.push({
      dimension: "job-relatedness",
      message: `Only ${related}/${total} questions are anchored to the role; ${generic} are generic.`,
    });
  }

  return {
    rationale: `${related}/${total} questions connect to the role brief; ${generic} generic prompt(s).`,
    score,
  };
}

function gradeBehavioralAnchoring(
  plan: InterviewPlan,
  issues: DraftQualityIssue[],
): DraftQualityDimensionScore {
  let anchored = 0;

  for (const question of plan.questions) {
    const normalized = question.prompt.trim().toLowerCase();
    const longEnough = normalized.length >= 40;
    const hasCue = BEHAVIORAL_CUES.some((cue) => normalized.includes(cue));
    const isGeneric = GENERIC_PROMPTS.some((generic) =>
      normalized.startsWith(generic),
    );

    if (longEnough && hasCue && !isGeneric) {
      anchored += 1;
    }
  }

  const total = plan.questions.length || 1;
  const score = clampScore(Math.round((anchored / total) * 100));

  if (score < 60) {
    issues.push({
      dimension: "behavioral-anchoring",
      message: `Only ${anchored}/${total} questions invite a concrete past situation or example.`,
    });
  }

  return {
    rationale: `${anchored}/${total} questions are behaviorally anchored (length + phrasing heuristics).`,
    score,
  };
}

function gradeSignalClarity(
  plan: InterviewPlan,
  issues: DraftQualityIssue[],
): DraftQualityDimensionScore {
  let substantive = 0;

  for (const question of plan.questions) {
    const signal = (question.expectedSignal ?? "").trim();
    // Substantive = present, multi-word, not a bare placeholder.
    if (signal.length >= 12 && signal.split(/\s+/u).length >= 2) {
      substantive += 1;
    }
  }

  const total = plan.questions.length || 1;
  const criteriaCovered = plan.criteria.every(
    (criterion) => criterion.description.trim().length >= 12,
  );
  const base = Math.round((substantive / total) * 100);
  const score = clampScore(criteriaCovered ? base : base - 15);

  if (score < 60) {
    issues.push({
      dimension: "signal-clarity",
      message: `Only ${substantive}/${total} questions declare a substantive expectedSignal.`,
    });
  }

  return {
    rationale: `${substantive}/${total} questions state a substantive expected signal; criteria descriptions ${criteriaCovered ? "are" : "are not"} all specific.`,
    score,
  };
}

function gradeNonRedundancy(
  plan: InterviewPlan,
  issues: DraftQualityIssue[],
): DraftQualityDimensionScore {
  const prompts = plan.questions.map((question) => question.prompt);
  const categories = new Set(plan.questions.map((question) => question.category));
  let nearDuplicates = 0;

  for (let i = 0; i < prompts.length; i += 1) {
    for (let j = i + 1; j < prompts.length; j += 1) {
      if (promptsAreNearDuplicate(prompts[i]!, prompts[j]!)) {
        nearDuplicates += 1;
      }
    }
  }

  const total = plan.questions.length || 1;
  // Reward category diversity, penalize each near-duplicate pair heavily.
  const diversityBonus = Math.min(30, (categories.size - 1) * 10);
  const score = clampScore(70 + diversityBonus - nearDuplicates * 35);

  if (score < 60) {
    issues.push({
      dimension: "non-redundancy",
      message: `${nearDuplicates} near-duplicate prompt pair(s) across ${total} questions; ${categories.size} distinct categories.`,
    });
  }

  return {
    rationale: `${nearDuplicates} near-duplicate pair(s); ${categories.size} distinct question categories.`,
    score,
  };
}

function promptsAreNearDuplicate(a: string, b: string): boolean {
  const left = tokenizeArray(a);
  const right = new Set(tokenizeArray(b));

  if (left.length === 0 || right.size === 0) {
    return false;
  }

  const overlap = left.filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  // Jaccard similarity over content tokens.
  return overlap / union >= 0.6;
}

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "please",
  "tell",
  "that",
  "the",
  "to",
  "us",
  "we",
  "what",
  "when",
  "where",
  "would",
  "you",
  "your",
]);

function tokenizeArray(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function tokenize(value: string): Set<string> {
  return new Set(tokenizeArray(value));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ---------------------------------------------------------------------------
// OpenAI LLM judge: grades quality against the rubric with the Responses API
// and a strict json_schema. Fails soft to an "unavailable" report on any error
// and never throws. The deterministic compliance gate is applied locally on
// top of the judge so a model miss can never let a protected-topic draft pass.
// ---------------------------------------------------------------------------
export function createOpenAIDraftQualityEvaluator({
  apiKey,
  fetcher = defaultFetcher,
  model,
  timeoutMs,
}: OpenAIDraftQualityEvaluatorOptions): DraftQualityEvaluator {
  return {
    evaluate: async (plan) => {
      try {
        const payload = await createOpenAIJudgement({
          apiKey,
          fetcher,
          model,
          plan,
          timeoutMs,
        });

        const report = parseJudgeReport(payload, model);
        return applyLocalComplianceGate(plan, report);
      } catch (error) {
        console.warn(
          "Draft-quality LLM judge failed soft (evaluation unavailable).",
          error,
        );
        return unavailableReport("openai_judge", model);
      }
    },
    modelName: model,
    provider: "openai_judge",
  };
}

const judgeJsonSchema = {
  additionalProperties: false,
  properties: {
    dimensions: {
      items: {
        additionalProperties: false,
        properties: {
          dimension: { enum: [...draftQualityDimensions], type: "string" },
          rationale: { type: "string" },
          score: { maximum: 100, minimum: 0, type: "integer" },
        },
        required: ["dimension", "score", "rationale"],
        type: "object",
      },
      type: "array",
    },
    issues: {
      items: { type: "string" },
      type: "array",
    },
    overallScore: { maximum: 100, minimum: 0, type: "integer" },
  },
  required: ["overallScore", "dimensions", "issues"],
  type: "object",
} as const;

async function createOpenAIJudgement({
  apiKey,
  fetcher,
  model,
  plan,
  timeoutMs,
}: {
  apiKey: string;
  fetcher: Fetcher;
  model: string;
  plan: InterviewPlan;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(OPENAI_RESPONSES_URL, {
      body: JSON.stringify({
        input: [
          {
            content: judgeSystemInstructions(),
            role: "system",
          },
          {
            content: JSON.stringify(buildJudgeInput(plan), null, 2),
            role: "user",
          },
        ],
        max_output_tokens: 1024,
        model,
        store: false,
        temperature: 0,
        text: {
          format: {
            name: "draft_quality_report",
            schema: judgeJsonSchema,
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
      throw new Error(
        `Draft-quality judge failed with HTTP ${response.status}`,
      );
    }

    return JSON.parse(extractJsonObject(extractOutputText(await response.json())));
  } finally {
    clearTimeout(timeout);
  }
}

function buildJudgeInput(plan: InterviewPlan) {
  return {
    criteria: plan.criteria.map((criterion) => ({
      description: criterion.description,
      label: criterion.label,
    })),
    promptVersion: draftQualityEvalPromptVersion,
    questions: plan.questions.map((question) => ({
      category: question.category,
      expectedSignal: question.expectedSignal ?? "",
      prompt: question.prompt,
    })),
    roleBrief: plan.roleBrief,
    roleTitle: plan.roleTitle,
    seniority: plan.seniority,
  };
}

function judgeSystemInstructions() {
  return [
    "You are a hiring-quality reviewer for Prelude.ai first-screen interview drafts.",
    "Score the draft from 0-100 on each rubric dimension, then give an overall 0-100 score.",
    "Rubric dimensions:",
    "- job-relatedness: every question and criterion is tied to the role brief and seniority, not generic.",
    "- behavioral-anchoring: questions invite a concrete past situation, example, or judgment rather than abstractions.",
    "- signal-clarity: each question has a clear, substantive expected signal and criteria say what a strong answer looks like.",
    "- non-redundancy: questions cover distinct competencies with no near-duplicate prompts.",
    "- compliance-safety: no question or criterion probes protected attributes, appearance, accent, tone, emotion, biometrics, or frames an automated hire/reject decision.",
    "Reward focused, fair, evidence-seeking first-screen questions. Penalize generic, redundant, vague, or non-job-related prompts.",
    "Return JSON only, matching the requested schema, with one entry per dimension and a short rationale each.",
    `Prompt version: ${draftQualityEvalPromptVersion}.`,
  ].join(" ");
}

function parseJudgeReport(
  payload: unknown,
  model: string,
): DraftQualityReport {
  if (!isRecord(payload) || !Array.isArray(payload.dimensions)) {
    throw new Error("Draft-quality judge returned an invalid payload");
  }

  const dimensions = emptyDimensions();
  const seen = new Set<DraftQualityDimension>();

  for (const entry of payload.dimensions) {
    if (!isRecord(entry)) {
      continue;
    }
    const dimension = readDimension(entry.dimension);
    if (!dimension) {
      continue;
    }
    dimensions[dimension] = {
      rationale:
        typeof entry.rationale === "string"
          ? entry.rationale.trim().slice(0, 400)
          : "",
      score: clampScore(toNumber(entry.score)),
    };
    seen.add(dimension);
  }

  // The judge must cover every rubric dimension; a partial verdict is treated
  // as malformed so we fail soft rather than reporting a misleading score.
  if (seen.size !== draftQualityDimensions.length) {
    throw new Error("Draft-quality judge omitted one or more dimensions");
  }

  const overallScore = clampScore(toNumber(payload.overallScore));
  const issues: DraftQualityIssue[] = Array.isArray(payload.issues)
    ? payload.issues
        .filter((issue): issue is string => typeof issue === "string")
        .map((message) => ({ dimension: "plan", message }))
    : [];

  return {
    available: true,
    dimensions,
    issues,
    modelName: model,
    overallScore,
    passed: overallScore >= draftQualityRegressionThreshold,
    provider: "openai_judge",
  };
}

// Re-applies the deterministic, authoritative compliance gate on top of the
// LLM judgement: if any segment violates policy, the compliance dimension is
// forced to 0 and the draft cannot pass — the judge is advisory for quality
// but never authoritative for compliance.
function applyLocalComplianceGate(
  plan: InterviewPlan,
  report: DraftQualityReport,
): DraftQualityReport {
  const localCompliance = gradeCompliance(plan, []);

  if (localCompliance.score > 0) {
    return report;
  }

  return {
    ...report,
    dimensions: {
      ...report.dimensions,
      "compliance-safety": localCompliance,
    },
    issues: [
      ...report.issues,
      {
        dimension: "compliance-safety",
        message:
          "Local keyword policy flagged a protected-topic or automated-decision violation.",
      },
    ],
    overallScore: Math.min(report.overallScore, 40),
    passed: false,
  };
}

function emptyDimensions(): Record<
  DraftQualityDimension,
  DraftQualityDimensionScore
> {
  return {
    "job-relatedness": { rationale: "", score: 0 },
    "behavioral-anchoring": { rationale: "", score: 0 },
    "signal-clarity": { rationale: "", score: 0 },
    "non-redundancy": { rationale: "", score: 0 },
    "compliance-safety": { rationale: "", score: 0 },
  };
}

function unavailableReport(provider: string, modelName: string): DraftQualityReport {
  return {
    available: false,
    dimensions: emptyDimensions(),
    issues: [
      {
        dimension: "plan",
        message: "Draft quality evaluation unavailable.",
      },
    ],
    modelName,
    overallScore: 0,
    passed: false,
    provider,
  };
}

function readDimension(value: unknown): DraftQualityDimension | null {
  return (draftQualityDimensions as readonly string[]).includes(value as string)
    ? (value as DraftQualityDimension)
    : null;
}

async function defaultFetcher(
  url: string,
  init: Parameters<Fetcher>[1],
): Promise<FetchResponse> {
  return fetch(url, init);
}

function extractOutputText(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("Draft-quality judge returned no payload");
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

  throw new Error("Draft-quality judge returned no output text");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toTimeoutMs(value: string | undefined) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 12_000;
  }

  return Math.max(2_000, Math.min(30_000, seconds * 1000));
}
