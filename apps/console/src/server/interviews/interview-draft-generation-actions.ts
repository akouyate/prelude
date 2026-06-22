"use server";

import type {
  InterviewAgentDraft,
  InterviewFocus,
  InterviewQuestionDraft,
  InterviewSeniority,
} from "@prelude/core";

import { interviewPlanPolicy } from "../../domain/interview-plan-policy";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import type { InterviewResponseMode } from "./interview-drafts";
import {
  createInterviewDraftGeneratorFromEnv,
  type InterviewDraftGenerationInput,
} from "./interview-draft-generation";

export type GenerateInterviewDraftActionInput = InterviewDraftGenerationInput;

export type RefineInterviewQuestionActionInput = InterviewDraftGenerationInput & {
  action: "sharper" | "replace";
  draft: InterviewAgentDraft;
  questionId: string;
};

export type AddInterviewQuestionActionInput = InterviewDraftGenerationInput & {
  draft: InterviewAgentDraft;
  topic: string;
};

export type InterviewDraftGenerationActionResult =
  | {
      draft: InterviewAgentDraft;
      modelName: string;
      ok: true;
      provider: string;
    }
  | {
      error: string;
      ok: false;
    };

export type InterviewQuestionGenerationActionResult =
  | {
      draft: InterviewAgentDraft;
      modelName: string;
      ok: true;
      provider: string;
      questionId: string;
    }
  | {
      error: string;
      ok: false;
    };

export async function generateInterviewDraftAction(
  input: GenerateInterviewDraftActionInput,
): Promise<InterviewDraftGenerationActionResult> {
  const normalized = normalizeGenerationInput(input);

  if (!normalized.ok) {
    return normalized;
  }

  await getCompletedOrganizationScope();

  const generator = createInterviewDraftGeneratorFromEnv();

  try {
    // N9: use the provenance-aware path so the returned provider/model reflect
    // the engine that actually produced the draft (e.g. a deterministic
    // fallback when OpenAI was unavailable), not the generator's static label.
    const generated = await generator.generateDraftWithProvenance(
      normalized.input,
    );

    return {
      draft: generated.draft,
      modelName: generated.modelName,
      ok: true,
      provider: generated.provider,
    };
  } catch (error) {
    return { error: toPublicGenerationError(error), ok: false };
  }
}

export async function refineInterviewQuestionAction(
  input: RefineInterviewQuestionActionInput,
): Promise<InterviewQuestionGenerationActionResult> {
  const normalized = normalizeGenerationInput(input);

  if (!normalized.ok) {
    return normalized;
  }

  const question = input.draft.questions.find((item) => item.id === input.questionId);

  if (!question) {
    return { error: "Select a question before asking Prelude to refine it.", ok: false };
  }

  await getCompletedOrganizationScope();

  const generator = createInterviewDraftGeneratorFromEnv();

  try {
    const nextQuestion = await generator.refineQuestion({
      ...normalized.input,
      action: input.action,
      draft: input.draft,
      question,
    });

    return {
      draft: {
        ...input.draft,
        questions: input.draft.questions.map((item) =>
          item.id === input.questionId ? nextQuestion : item,
        ),
        rationale: `Prelude refined one question while keeping this role screen focused on ${input.draft.questions.length} first-screening questions.`,
      },
      modelName: generator.modelName,
      ok: true,
      provider: generator.provider,
      questionId: nextQuestion.id,
    };
  } catch (error) {
    return { error: toPublicGenerationError(error), ok: false };
  }
}

export async function addInterviewQuestionAction(
  input: AddInterviewQuestionActionInput,
): Promise<InterviewQuestionGenerationActionResult> {
  const normalized = normalizeGenerationInput(input);

  if (!normalized.ok) {
    return normalized;
  }

  if (input.draft.questions.length >= interviewPlanPolicy.maxQuestions) {
    return {
      error: "This role screen already has 5 questions, which is the V1 limit.",
      ok: false,
    };
  }

  const topic = normalizeQuestionTopic(input.topic);

  await getCompletedOrganizationScope();

  const generator = createInterviewDraftGeneratorFromEnv();

  try {
    const question = await generator.addQuestion({
      ...normalized.input,
      draft: input.draft,
      topic,
    });
    const questions = [...input.draft.questions, question];

    return {
      draft: {
        ...input.draft,
        estimatedMinutes: estimateMinutes(questions),
        questions,
        rationale: `Prelude prepared ${questions.length} focused questions for this first-screening role screen.`,
      },
      modelName: generator.modelName,
      ok: true,
      provider: generator.provider,
      questionId: question.id,
    };
  } catch (error) {
    return { error: toPublicGenerationError(error), ok: false };
  }
}

function normalizeQuestionTopic(value: string) {
  return value.trim().slice(0, 120) || "screening fit";
}

function normalizeGenerationInput(
  input: InterviewDraftGenerationInput,
):
  | {
      input: InterviewDraftGenerationInput;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    } {
  const roleTitle = input.roleTitle.trim();
  const roleBrief = input.roleBrief.trim();

  if (roleTitle.length < 2) {
    return { error: "Add a role title before generating questions.", ok: false };
  }

  if (roleBrief.length < 40) {
    return {
      error: "Add enough job context for Prelude to draft a fair first screen.",
      ok: false,
    };
  }

  return {
    input: {
      companyName: input.companyName.trim() || "the company",
      focus: normalizeFocus(input.focus),
      responseModes: normalizeResponseModes(input.responseModes),
      roleBrief,
      roleTitle,
      seniority: normalizeSeniority(input.seniority),
      sourceAttachmentName: input.sourceAttachmentName?.trim() || undefined,
    },
    ok: true,
  };
}

function normalizeFocus(value: InterviewFocus[]) {
  const allowed = new Set<InterviewFocus>([
    "communication",
    "motivation",
    "role_skills",
    "situational_judgment",
  ]);
  const focus = value.filter((item) => allowed.has(item));

  return focus.length > 0
    ? focus
    : (["role_skills", "situational_judgment", "motivation"] satisfies InterviewFocus[]);
}

function normalizeResponseModes(value: InterviewResponseMode[]) {
  const allowed = new Set<InterviewResponseMode>(["audio", "text"]);
  const modes = value.filter((mode) => allowed.has(mode));

  return modes.length > 0 ? modes : (["text"] satisfies InterviewResponseMode[]);
}

function normalizeSeniority(value: InterviewSeniority) {
  if (value === "junior" || value === "mid" || value === "senior") {
    return value;
  }

  return "mid";
}

function estimateMinutes(questions: InterviewQuestionDraft[]) {
  return Math.max(
    4,
    Math.round(
      questions.reduce((sum, question) => sum + question.durationSeconds, 0) /
        60,
    ),
  );
}

function toPublicGenerationError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Prelude could not generate this draft.";

  if (message.includes("not configured")) {
    return message;
  }

  return "Prelude could not generate the role draft. Please retry in a moment.";
}
