"use server";

import type {
  InterviewAgentDraft,
  InterviewFocus,
  InterviewQuestionDraft,
  InterviewSeniority,
} from "@prelude/core";

import { interviewPlanPolicy } from "../../domain/interview-plan-policy";
import { canManageRoles } from "../../domain/organization-permissions";
import { getServerT } from "../../libs/i18n-server";
import { resolveInterviewLanguage } from "../organizations/content-language";
import { loadOrganizationContentLanguages } from "../organizations/organization-content-languages";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { getAuthenticatedUserLocale } from "../users/user-locale";
import type { InterviewResponseMode } from "./interview-drafts";
import {
  buildQuestionEditRationale,
  createInterviewDraftGeneratorFromEnv,
  type InterviewDraftGenerationInput,
} from "./interview-draft-generation";

/**
 * What the builder actually sends. Both language facts are resolved on the
 * server (plan 2026-08-18, rule 1): the client may hint at the INTERVIEW
 * language through its selector, and never has a say in the WORKSPACE language,
 * which governs a shared artifact read by the whole team.
 */
export type GenerateInterviewDraftActionInput = Omit<
  InterviewDraftGenerationInput,
  "interviewLanguage" | "workspaceLanguage"
> & {
  interviewLanguage?: string;
};

export type RefineInterviewQuestionActionInput =
  GenerateInterviewDraftActionInput & {
    action: "sharper" | "replace";
    draft: InterviewAgentDraft;
    questionId: string;
  };

export type AddInterviewQuestionActionInput =
  GenerateInterviewDraftActionInput & {
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

  const authorization = await authorizeRoleManagement();
  if (!authorization.ok) {
    return { error: authorization.error, ok: false };
  }

  const generator = createInterviewDraftGeneratorFromEnv();

  try {
    // N9: use the provenance-aware path so the returned provider/model reflect
    // the engine that actually produced the draft (e.g. a deterministic
    // fallback when OpenAI was unavailable), not the generator's static label.
    const generated = await generator.generateDraftWithProvenance({
      ...normalized.input,
      ...(await resolveGenerationLanguages(
        authorization.organizationId,
        input.interviewLanguage,
      )),
    });

    return {
      draft: generated.draft,
      modelName: generated.modelName,
      ok: true,
      provider: generated.provider,
    };
  } catch (error) {
    return { error: await toPublicGenerationError(error), ok: false };
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
    return { error: "Select a question before asking HireCall to refine it.", ok: false };
  }

  const authorization = await authorizeRoleManagement();
  if (!authorization.ok) {
    return { error: authorization.error, ok: false };
  }

  const generator = createInterviewDraftGeneratorFromEnv();

  try {
    const languages = await resolveGenerationLanguages(
      authorization.organizationId,
      input.interviewLanguage,
    );
    const nextQuestion = await generator.refineQuestion({
      ...normalized.input,
      ...languages,
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
        rationale: buildQuestionEditRationale({
          change: "refined",
          questionCount: input.draft.questions.length,
          workspaceLanguage: languages.workspaceLanguage,
        }),
      },
      modelName: generator.modelName,
      ok: true,
      provider: generator.provider,
      questionId: nextQuestion.id,
    };
  } catch (error) {
    return { error: await toPublicGenerationError(error), ok: false };
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

  const authorization = await authorizeRoleManagement();
  if (!authorization.ok) {
    return { error: authorization.error, ok: false };
  }

  const generator = createInterviewDraftGeneratorFromEnv();

  try {
    const languages = await resolveGenerationLanguages(
      authorization.organizationId,
      input.interviewLanguage,
    );
    const question = await generator.addQuestion({
      ...normalized.input,
      ...languages,
      draft: input.draft,
      topic,
    });
    const questions = [...input.draft.questions, question];

    return {
      draft: {
        ...input.draft,
        estimatedMinutes: estimateMinutes(questions),
        questions,
        rationale: buildQuestionEditRationale({
          change: "added",
          questionCount: questions.length,
          workspaceLanguage: languages.workspaceLanguage,
        }),
      },
      modelName: generator.modelName,
      ok: true,
      provider: generator.provider,
      questionId: question.id,
    };
  } catch (error) {
    return { error: await toPublicGenerationError(error), ok: false };
  }
}

async function authorizeRoleManagement(): Promise<
  { ok: true; organizationId: string } | { error: string; ok: false }
> {
  const scope = await getCompletedOrganizationScope();
  if (canManageRoles(scope.role)) {
    return { ok: true, organizationId: scope.organizationId };
  }

  const t = getServerT(await getAuthenticatedUserLocale(scope.userId));
  return { error: t("roleManagement.forbidden"), ok: false };
}

/**
 * The two language facts the generator needs, resolved from the workspace.
 *
 * `interviewLanguageHint` is the builder's selector — advisory, and validated
 * here rather than trusted: `resolveInterviewLanguage` drops anything outside
 * the en/fr catalogue and falls through to the workspace's interview default.
 * The workspace language is read only from settings, never from the request.
 */
async function resolveGenerationLanguages(
  organizationId: string,
  interviewLanguageHint: string | undefined,
) {
  const languages = await loadOrganizationContentLanguages(organizationId);

  return {
    interviewLanguage: resolveInterviewLanguage(
      interviewLanguageHint,
      languages.interviewDefault,
    ),
    workspaceLanguage: languages.workspace,
  };
}

function normalizeQuestionTopic(value: string) {
  return value.trim().slice(0, 120) || "screening fit";
}

// The languages are resolved separately, from the workspace, so they are
// deliberately absent from what this validator returns.
type NormalizedGenerationInput = Omit<
  InterviewDraftGenerationInput,
  "interviewLanguage" | "workspaceLanguage"
>;

function normalizeGenerationInput(
  input: GenerateInterviewDraftActionInput,
):
  | {
      input: NormalizedGenerationInput;
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
      error: "Add enough job context for HireCall to draft a fair first screen.",
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

/*
 * This string reaches the recruiter's screen (the builder renders `result.error`
 * verbatim), so it is translated. The one exception is a misconfiguration
 * message, which is deliberately passed through untranslated: it names an env
 * var to whoever is setting the deployment up, and turning that into French
 * would make it harder, not easier, to act on.
 */
async function toPublicGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("not configured")) {
    return message;
  }

  const t = getServerT(await getAuthenticatedUserLocale());

  return t("interviewBuilder.generationFailedRetry");
}
