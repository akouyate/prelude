import { z } from "zod";

import {
  liveInterviewModeSchema,
  liveInterviewPlanSchema,
  liveInterviewQuestionCategorySchema,
  type LiveInterviewMode,
  type LiveInterviewPlan,
} from "./live-interview";

export const INTERVIEW_PLAN_SCHEMA_VERSION = 1 as const;

export const interviewQuestionSourceSchema = z.enum([
  "job_description",
  "attachment",
  "agent",
]);

export const interviewResponseModeSchema = z.enum(["audio", "text"]);

// Mirror @prelude/core InterviewSeniority + InterviewFocus exactly.
export const interviewSeniorityCanonicalSchema = z.enum([
  "junior",
  "mid",
  "senior",
]);

export const interviewFocusCanonicalSchema = z.enum([
  "motivation",
  "role_skills",
  "situational_judgment",
  "communication",
]);

export const interviewPlanQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().trim().min(8).max(800),
  expectedSignal: z.string().trim().min(4).max(500).optional(),
  category: liveInterviewQuestionCategorySchema.default("custom"),
  required: z.boolean().default(true),
  maxFollowups: z.number().int().min(0).max(1).default(1),
  durationSeconds: z.number().int().min(30).max(180).default(75),
  source: interviewQuestionSourceSchema.default("agent"),
});

export const interviewPlanCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(2).max(160),
  description: z.string().trim().min(8).max(800),
});

export const interviewPlanSchema = z.object({
  schemaVersion: z
    .literal(INTERVIEW_PLAN_SCHEMA_VERSION)
    .default(INTERVIEW_PLAN_SCHEMA_VERSION),
  roleTitle: z.string().trim().min(2).max(160),
  roleBrief: z.string().trim().default(""),
  seniority: interviewSeniorityCanonicalSchema.nullable().default(null),
  focus: z.array(interviewFocusCanonicalSchema).default([]),
  responseModes: z.array(interviewResponseModeSchema).default([]),
  questions: z.array(interviewPlanQuestionSchema).min(1).max(5),
  criteria: z.array(interviewPlanCriterionSchema).min(1).max(5),
  guardrails: z.array(z.string()).default([]),
  estimatedMinutes: z.number().int().min(1).max(60).nullable().default(null),
  rationale: z.string().default(""),
});

export type InterviewPlanQuestion = z.infer<typeof interviewPlanQuestionSchema>;
export type InterviewPlanCriterion = z.infer<
  typeof interviewPlanCriterionSchema
>;
export type InterviewPlan = z.infer<typeof interviewPlanSchema>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const legacyCategoryFromSourceFocus = (
  source: unknown,
  focus: unknown,
): z.infer<typeof liveInterviewQuestionCategorySchema> => {
  const focusList = asArray(focus).filter(
    (item): item is string => typeof item === "string",
  );
  if (focusList.includes("motivation")) {
    return "motivation";
  }
  if (source === "job_description") {
    return "experience";
  }
  if (source === "attachment") {
    return "skills";
  }
  return "custom";
};

export const storedInterviewPlanSchema = z.preprocess((raw) => {
  if (!isRecord(raw)) {
    return raw;
  }

  const focus = raw.focus;

  const questions = asArray(raw.questions).map((value) => {
    if (!isRecord(value)) {
      return value;
    }

    const rawSignal =
      typeof value.expectedSignal === "string"
        ? value.expectedSignal
        : typeof value.signal === "string"
          ? value.signal
          : undefined;
    // A legacy signal shorter than the canonical minimum (4) drops to
    // undefined — the field is optional — rather than rejecting an
    // otherwise-valid persisted row at the publish guard.
    const trimmedSignal = rawSignal?.trim();
    const expectedSignal =
      trimmedSignal && trimmedSignal.length >= 4 ? trimmedSignal : undefined;
    const category =
      typeof value.category === "string"
        ? value.category
        : legacyCategoryFromSourceFocus(value.source, focus);

    return {
      id: value.id,
      prompt: value.prompt,
      expectedSignal,
      category,
      required: typeof value.required === "boolean" ? value.required : true,
      maxFollowups:
        typeof value.maxFollowups === "number" ? value.maxFollowups : 1,
      durationSeconds:
        typeof value.durationSeconds === "number" ? value.durationSeconds : 75,
      source: typeof value.source === "string" ? value.source : "agent",
    };
  });

  return {
    schemaVersion:
      typeof raw.schemaVersion === "number"
        ? raw.schemaVersion
        : INTERVIEW_PLAN_SCHEMA_VERSION,
    roleTitle: raw.roleTitle,
    roleBrief: typeof raw.roleBrief === "string" ? raw.roleBrief : "",
    seniority: typeof raw.seniority === "string" ? raw.seniority : null,
    focus: asArray(focus),
    // "video" was dropped as a selectable/publishable mode. Filter it out of
    // legacy rows so a previously-persisted plan never rejects on read.
    responseModes: asArray(raw.responseModes).filter(
      (mode) => mode !== "video",
    ),
    questions,
    criteria: asArray(raw.criteria),
    guardrails: asArray(raw.guardrails),
    estimatedMinutes:
      typeof raw.estimatedMinutes === "number" ? raw.estimatedMinutes : null,
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
  };
}, interviewPlanSchema);

export const parseStoredInterviewPlan = (raw: unknown): InterviewPlan =>
  storedInterviewPlanSchema.parse(raw);

const toLiveMode = (mode: InterviewPlan["responseModes"][number]): LiveInterviewMode =>
  mode === "text" ? "form" : mode;

export function toLiveInterviewPlan(args: {
  plan: InterviewPlan;
  planId: string;
  jobId: string;
  locale?: string;
}): LiveInterviewPlan {
  const modes = args.plan.responseModes.length
    ? args.plan.responseModes.map(toLiveMode)
    : (["audio"] as LiveInterviewMode[]);

  return liveInterviewPlanSchema.parse({
    planId: args.planId,
    jobId: args.jobId,
    roleTitle: args.plan.roleTitle,
    locale: args.locale ?? "fr-FR",
    candidateModes: [...new Set(modes)].slice(0, 3),
    questions: args.plan.questions.slice(0, 8).map((question) => ({
      id: question.id,
      prompt: question.prompt,
      category: question.category,
      expectedSignal: question.expectedSignal,
      required: question.required,
      maxFollowups: question.maxFollowups,
    })),
  });
}
