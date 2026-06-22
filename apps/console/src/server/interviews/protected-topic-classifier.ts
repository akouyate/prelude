import {
  protectedTopicCategories,
  textViolatesPolicy,
  type ProtectedTopicCategory,
} from "@prelude/core";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const protectedTopicClassifierPromptVersion = "protected-topic-v1";
// Pin the json_schema shape independently of the prompt: the schema can change
// (categories, fields) and silently alter verdict semantics, so an audit record
// must record which schema produced the verdict it captured.
export const protectedTopicClassifierSchemaVersion = "protected-topic-schema-v1";
export const defaultProtectedTopicModel = "gpt-4.1-mini";

// N6b — categories that can NEVER be overridden by a recruiter. These are the
// gravest protected classes where there is essentially no legitimate, job-related
// reason to ask, plus the generic fallback (if the model could not even name a
// specific class, an override would be a blind dismissal) and the
// emotion/biometric/automated-decision scoring categories the product forbids
// outright. A flag in any of these stays a hard block with no recourse; the
// recruiter must reformulate. Every other category is overridable WITH a
// substantive justification and a persisted audit record.
export const nonOverridableProtectedTopicCategories = new Set<ProtectedTopicCategory>(
  [
    "disability_or_health",
    "genetic_information",
    "biometric_or_face_analysis",
    "emotion",
    "automated_decision",
    "protected_topic",
    "none",
  ],
);

export function isOverridableProtectedTopicCategory(
  category: string,
): boolean {
  return !nonOverridableProtectedTopicCategories.has(
    category as ProtectedTopicCategory,
  );
}

export type ProtectedTopicClassification = {
  flagged: boolean;
  category: ProtectedTopicCategory;
  reason: string;
};

export type ProtectedTopicClassifyOptions = {
  // N6d: recruiter UI language so the model writes `reason` in the same language
  // as the rest of the compliance message/override prompt. Defaults to English.
  locale?: string;
};

export type ProtectedTopicClassifier = {
  provider: string;
  modelName: string;
  classify: (
    texts: string[],
    options?: ProtectedTopicClassifyOptions,
  ) => Promise<ProtectedTopicClassification[]>;
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

export type OpenAIProtectedTopicClassifierOptions = {
  apiKey: string;
  fetcher?: Fetcher;
  model: string;
  timeoutMs: number;
};

const cleanResult = (): ProtectedTopicClassification => ({
  flagged: false,
  category: "none",
  reason: "",
});

export function createProtectedTopicClassifierFromEnv(
  source: Record<string, string | undefined> = process.env,
): ProtectedTopicClassifier {
  const mode = source.PROTECTED_TOPIC_CLASSIFIER;

  if (mode === "off") {
    return createDisabledProtectedTopicClassifier();
  }

  if (mode === "deterministic" || source.NODE_ENV === "test") {
    return createDeterministicProtectedTopicClassifier();
  }

  // A configured non-"openai" provider must never take this layer offline: it
  // is an additive safety net on top of the authoritative keyword gate, so it
  // degrades to deterministic rather than "unavailable".
  if (mode && mode !== "openai") {
    return createDeterministicProtectedTopicClassifier();
  }

  // Missing key degrades to keyword-only (deterministic) even in production —
  // N6 must never block the product because OpenAI is unconfigured.
  if (!source.OPENAI_API_KEY) {
    return createDeterministicProtectedTopicClassifier();
  }

  return createOpenAIProtectedTopicClassifier({
    apiKey: source.OPENAI_API_KEY,
    model: source.PROTECTED_TOPIC_LLM_MODEL ?? defaultProtectedTopicModel,
    timeoutMs: toTimeoutMs(source.PROTECTED_TOPIC_LLM_TIMEOUT_SECONDS),
  });
}

function createDisabledProtectedTopicClassifier(): ProtectedTopicClassifier {
  return {
    classify: async (texts) => texts.map(() => cleanResult()),
    modelName: "disabled",
    provider: "disabled",
  };
}

export function createDeterministicProtectedTopicClassifier(): ProtectedTopicClassifier {
  return {
    classify: async (texts, options) =>
      texts.map((text) => {
        const flagged = textViolatesPolicy(text);

        return flagged
          ? {
              flagged: true,
              category: "protected_topic" as ProtectedTopicCategory,
              reason:
                options?.locale === "fr"
                  ? "règle de mots-clés déclenchée"
                  : "matched keyword policy",
            }
          : cleanResult();
      }),
    modelName: "deterministic",
    provider: "deterministic",
  };
}

export function createOpenAIProtectedTopicClassifier({
  apiKey,
  fetcher = defaultFetcher,
  model,
  timeoutMs,
}: OpenAIProtectedTopicClassifierOptions): ProtectedTopicClassifier {
  return {
    classify: async (texts, options) => {
      if (texts.length === 0) {
        return [];
      }

      try {
        const payload = await createOpenAIClassification({
          apiKey,
          fetcher,
          locale: options?.locale,
          model,
          texts,
          timeoutMs,
        });

        return parseClassifications(payload, texts.length);
      } catch (error) {
        console.warn(
          "Protected-topic LLM classifier failed open (keyword layer remains authoritative).",
          error,
        );
        return texts.map(() => cleanResult());
      }
    },
    modelName: model,
    provider: "openai_responses",
  };
}

const classificationJsonSchema = {
  additionalProperties: false,
  properties: {
    results: {
      items: {
        additionalProperties: false,
        properties: {
          category: { enum: [...protectedTopicCategories], type: "string" },
          flagged: { type: "boolean" },
          index: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["index", "flagged", "category", "reason"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["results"],
  type: "object",
} as const;

async function createOpenAIClassification({
  apiKey,
  fetcher,
  locale,
  model,
  texts,
  timeoutMs,
}: {
  apiKey: string;
  fetcher: Fetcher;
  locale?: string;
  model: string;
  texts: string[];
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(OPENAI_RESPONSES_URL, {
      body: JSON.stringify({
        input: [
          {
            content: protectedTopicSystemInstructions(locale),
            role: "system",
          },
          {
            content: JSON.stringify(
              {
                segments: texts.map((text, index) => ({ index, text })),
              },
              null,
              2,
            ),
            role: "user",
          },
        ],
        max_output_tokens: Math.min(2048, 64 * texts.length + 128),
        model,
        store: false,
        temperature: 0.2,
        text: {
          format: {
            name: "protected_topic_classification",
            schema: classificationJsonSchema,
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
        `Protected-topic classification failed with HTTP ${response.status}`,
      );
    }

    return JSON.parse(extractJsonObject(extractOutputText(await response.json())));
  } finally {
    clearTimeout(timeout);
  }
}

function parseClassifications(
  payload: unknown,
  expectedLength: number,
): ProtectedTopicClassification[] {
  const failOpen = () =>
    Array.from({ length: expectedLength }, () => cleanResult());

  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return failOpen();
  }

  const results = payload.results;

  if (results.length !== expectedLength) {
    return failOpen();
  }

  const byIndex = new Map<number, ProtectedTopicClassification>();

  for (const entry of results) {
    if (!isRecord(entry) || typeof entry.index !== "number") {
      return failOpen();
    }

    byIndex.set(entry.index, normalizeClassification(entry));
  }

  const ordered: ProtectedTopicClassification[] = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const result = byIndex.get(index);

    if (!result) {
      return failOpen();
    }

    ordered.push(result);
  }

  return ordered;
}

function normalizeClassification(
  entry: Record<string, unknown>,
): ProtectedTopicClassification {
  const flagged = entry.flagged === true;
  const category = readCategory(entry.category);
  const rawReason = typeof entry.reason === "string" ? entry.reason : "";
  // Hard-truncate server-side: never trust the model's "under 120 chars"
  // instruction to keep an odd/long justification out of the recruiter UI.
  const reason = rawReason.trim().slice(0, 200);

  if (!flagged) {
    return cleanResult();
  }

  return {
    flagged: true,
    // A flagged verdict with no usable specific category falls back to the
    // neutral "protected_topic" (not the misleading "automated_decision").
    category: category === "none" ? "protected_topic" : category,
    reason,
  };
}

function readCategory(value: unknown): ProtectedTopicCategory {
  if (
    typeof value === "string" &&
    (protectedTopicCategories as readonly string[]).includes(value)
  ) {
    return value as ProtectedTopicCategory;
  }

  return "none";
}

function protectedTopicSystemInstructions(locale?: string) {
  // N6d: the verdict `reason` is shown verbatim to the recruiter, so it must be
  // written in their UI language (the categories/messages around it already are).
  const reasonLanguageInstruction =
    locale === "fr"
      ? "Write the reason field in French."
      : "Write the reason field in English.";

  return [
    "You are a recruiting-compliance classifier for first-screen interview content.",
    "You receive a JSON array of segments (each a question or evaluation criterion) with a numeric index.",
    "Flag a segment when it asks about, infers, or scores a candidate's PROTECTED attribute in ANY language:",
    "age, appearance, accent, emotion, ethnicity or national origin, disability or health, family status or pregnancy,",
    "gender or sexual orientation, religion or political opinion, biometric or face analysis, or automated hire/reject scoring.",
    "Also flag these protected classes — recruiters often use indirect proxies for them:",
    "- union or collective/political activity (union_or_political_activity), e.g. 'are you active in any workplace organizing?',",
    "  'participez-vous à des mouvements collectifs au travail ?' — note FR Code du travail L1132-1 protects union activity;",
    "- criminal or arrest record (criminal_record), e.g. 'anything in your past a background check would surface?';",
    "- credit or financial history (credit_or_financial), e.g. 'are you financially stable?';",
    "- genetic information or family medical history (genetic_information), e.g. 'any long-term conditions that run in your family?'.",
    "Catch paraphrases, coded language, and indirect proxies (e.g. graduation decade for age, home/family life for caregiving,",
    "'unusual name, where is it from' for origin), including languages beyond English and French.",
    "Apply SELF-vs-DOMAIN: do NOT flag the health of a SYSTEM or service ('état de santé d'un système'),",
    "healthcare/clinical job skills about patients, work-authorization-as-eligibility, bona-fide language requirements for the role,",
    "ADA-style essential-function ability questions ('can you lift 25 kg with or without reasonable accommodation'),",
    "or legitimate role-domain HR/DEI subject-matter questions.",
    "Flag emotion, biometric, appearance, or on-camera-composure scoring of the candidate.",
    "Return one result per segment, preserving its index. Use category=\"none\" and reason=\"\" when not flagged.",
    "Keep reason under 120 characters. Respond with JSON only.",
    reasonLanguageInstruction,
    `Prompt version: ${protectedTopicClassifierPromptVersion}.`,
  ].join(" ");
}

async function defaultFetcher(
  url: string,
  init: Parameters<Fetcher>[1],
): Promise<FetchResponse> {
  return fetch(url, init);
}

function extractOutputText(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("Protected-topic classification returned no payload");
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const output = payload.output;
  if (Array.isArray(output)) {
    const text = output
      .flatMap((item) => {
        if (!isRecord(item) || !Array.isArray(item.content)) {
          return [];
        }
        return item.content;
      })
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

  throw new Error("Protected-topic classification returned no output text");
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

function toTimeoutMs(value: string | undefined) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 6_000;
  }

  return Math.max(2_000, Math.min(30_000, seconds * 1000));
}
