"use server";

import { randomBytes } from "node:crypto";

import { prisma, type Prisma } from "@prelude/db";
import type {
  InterviewAgentDraft,
  InterviewCriterionDraft,
  InterviewFocus,
  InterviewQuestionDraft,
  InterviewSeniority,
} from "@prelude/core";
import { revalidatePath } from "next/cache";

import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type InterviewResponseMode = "audio" | "video" | "text";

export type SaveInterviewDraftInput = {
  draftId?: string;
  jobId?: string;
  roleTitle: string;
  roleBrief: string;
  seniority: InterviewSeniority;
  focus: InterviewFocus[];
  responseModes: InterviewResponseMode[];
  questions: InterviewQuestionDraft[];
  criteria: InterviewCriterionDraft[];
  guardrails: string[];
  estimatedMinutes: number;
  rationale: string;
  sourceAttachmentName?: string;
};

export type SaveInterviewDraftResult =
  | {
      ok: true;
      draftId: string;
      jobId: string;
      updatedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

export type PublishInterviewDraftResult =
  | {
      ok: true;
      candidatePath: string;
      detailPath: string;
      interviewId: string;
      publicToken: string;
    }
  | {
      ok: false;
      error: string;
    };

const allowedSeniorities = new Set<InterviewSeniority>([
  "junior",
  "mid",
  "senior",
]);
const allowedFocus = new Set<InterviewFocus>([
  "communication",
  "motivation",
  "role_skills",
  "situational_judgment",
]);
const allowedModes = new Set<InterviewResponseMode>([
  "audio",
  "text",
  "video",
]);

export async function saveInterviewDraft(
  input: SaveInterviewDraftInput,
): Promise<SaveInterviewDraftResult> {
  const normalized = normalizeDraftInput(input);

  if (!normalized.ok) {
    return normalized;
  }

  const scope = await getCompletedOrganizationScope();

  const result = await prisma.$transaction(async (tx) => {
    const job = input.jobId
      ? await tx.job.findFirst({
          where: {
            id: input.jobId,
            organizationId: scope.organizationId,
          },
        })
      : null;

    const persistedJob = job
      ? await tx.job.update({
          data: {
            description: normalized.data.roleBrief,
            title: normalized.data.roleTitle,
          },
          where: { id: job.id },
        })
      : await tx.job.create({
          data: {
            description: normalized.data.roleBrief,
            location: null,
            organizationId: scope.organizationId,
            sourceExternalId: `manual:${slugify(normalized.data.roleTitle)}`,
            sourceProvider: "manual",
            status: "draft",
            title: normalized.data.roleTitle,
          },
        });

    const draftData = toDraftPersistenceData({
      ...normalized.data,
      jobId: persistedJob.id,
      organizationId: scope.organizationId,
    });

    const existingDraft = input.draftId
      ? await tx.interviewDraft.findFirst({
          select: { id: true },
          where: {
            id: input.draftId,
            organizationId: scope.organizationId,
          },
        })
      : null;

    const draft = existingDraft
      ? await tx.interviewDraft.update({
          data: draftData,
          where: { id: existingDraft.id },
        })
      : await tx.interviewDraft.create({
          data: draftData,
        });

    return {
      draftId: draft.id,
      jobId: persistedJob.id,
      updatedAt: draft.updatedAt.toISOString(),
    };
  });

  revalidatePath("/");
  revalidatePath("/interviews/new");

  return {
    ok: true,
    ...result,
  };
}

export async function publishInterviewDraft(
  draftId: string,
): Promise<PublishInterviewDraftResult> {
  const normalizedDraftId = draftId.trim();

  if (!normalizedDraftId) {
    return { ok: false, error: "Save the draft before publishing." };
  }

  const scope = await getCompletedOrganizationScope();

  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.interviewDraft.findFirst({
      include: {
        interview: true,
      },
      where: {
        id: normalizedDraftId,
        organizationId: scope.organizationId,
      },
    });

    if (!draft) {
      return null;
    }

    const publicToken =
      draft.interview?.publicToken ?? (await createPublicToken(tx));

    const interviewData = {
      criteria: draft.criteria as Prisma.InputJsonValue,
      estimatedMinutes: draft.estimatedMinutes,
      focus: draft.focus as Prisma.InputJsonValue,
      guardrails: draft.guardrails as Prisma.InputJsonValue,
      jobId: draft.jobId,
      organizationId: scope.organizationId,
      publicToken,
      questions: draft.questions as Prisma.InputJsonValue,
      rationale: draft.rationale,
      responseModes: draft.responseModes as Prisma.InputJsonValue,
      roleBrief: draft.roleBrief,
      roleTitle: draft.roleTitle,
      seniority: draft.seniority,
      status: "published",
    };

    const interview = draft.interview
      ? await tx.interview.update({
          data: interviewData,
          where: { id: draft.interview.id },
        })
      : await tx.interview.create({
          data: {
            ...interviewData,
            draftId: draft.id,
          },
        });

    await tx.interviewDraft.update({
      data: { status: "published" },
      where: { id: draft.id },
    });

    return interview;
  });

  if (!result) {
    return { ok: false, error: "Interview draft not found." };
  }

  revalidatePath("/");
  revalidatePath(`/interviews/${result.id}`);

  return {
    ok: true,
    candidatePath: `/interview/${result.publicToken}`,
    detailPath: `/interviews/${result.id}`,
    interviewId: result.id,
    publicToken: result.publicToken,
  };
}

function normalizeDraftInput(input: SaveInterviewDraftInput):
  | {
      ok: true;
      data: SaveInterviewDraftInput;
    }
  | {
      ok: false;
      error: string;
    } {
  const roleTitle = input.roleTitle.trim();
  const roleBrief = input.roleBrief.trim();
  const seniority = allowedSeniorities.has(input.seniority)
    ? input.seniority
    : "mid";
  const focus = input.focus.filter((item) => allowedFocus.has(item));
  const responseModes = input.responseModes.filter((mode) =>
    allowedModes.has(mode),
  );
  const questions = input.questions
    .map(normalizeQuestion)
    .filter((question): question is InterviewQuestionDraft => Boolean(question));
  const criteria = input.criteria
    .map(normalizeCriterion)
    .filter((criterion): criterion is InterviewCriterionDraft =>
      Boolean(criterion),
    );
  const guardrails = input.guardrails
    .map((guardrail) => guardrail.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (roleTitle.length < 2) {
    return { ok: false, error: "Add a role title before saving." };
  }

  if (questions.length === 0) {
    return { ok: false, error: "Generate at least one question first." };
  }

  if (responseModes.length === 0) {
    return { ok: false, error: "Choose at least one candidate answer mode." };
  }

  return {
    ok: true,
    data: {
      criteria,
      draftId: input.draftId,
      estimatedMinutes: Math.max(1, Math.min(45, input.estimatedMinutes || 1)),
      focus,
      guardrails,
      jobId: input.jobId,
      questions,
      rationale: input.rationale.trim(),
      responseModes,
      roleBrief,
      roleTitle,
      seniority,
      sourceAttachmentName: input.sourceAttachmentName?.trim() || undefined,
    },
  };
}

function normalizeQuestion(
  question: InterviewQuestionDraft,
): InterviewQuestionDraft | null {
  const prompt = question.prompt.trim();

  if (prompt.length < 8) {
    return null;
  }

  return {
    durationSeconds: Math.max(30, Math.min(180, question.durationSeconds || 75)),
    id: question.id.trim() || slugify(prompt).slice(0, 48),
    prompt,
    signal: question.signal.trim() || "Job-related screening signal",
    source: question.source,
  };
}

function normalizeCriterion(
  criterion: InterviewCriterionDraft,
): InterviewCriterionDraft | null {
  const label = criterion.label.trim();

  if (label.length < 2) {
    return null;
  }

  return {
    description:
      criterion.description.trim() ||
      "Reviewer should look for concrete, job-related evidence.",
    id: criterion.id.trim() || slugify(label),
    label,
  };
}

function toDraftPersistenceData(
  input: SaveInterviewDraftInput & {
    jobId: string;
    organizationId: string;
  },
) {
  return {
    criteria: input.criteria as unknown as Prisma.InputJsonValue,
    estimatedMinutes: input.estimatedMinutes,
    focus: input.focus as unknown as Prisma.InputJsonValue,
    guardrails: input.guardrails as unknown as Prisma.InputJsonValue,
    jobId: input.jobId,
    organizationId: input.organizationId,
    questions: input.questions as unknown as Prisma.InputJsonValue,
    rationale: input.rationale,
    responseModes: input.responseModes as unknown as Prisma.InputJsonValue,
    roleBrief: input.roleBrief,
    roleTitle: input.roleTitle,
    seniority: input.seniority,
    sourceAttachmentName: input.sourceAttachmentName,
    status: "draft",
  };
}

async function createPublicToken(
  tx: Pick<Prisma.TransactionClient, "interview">,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = `iv_${randomBytes(9).toString("base64url")}`;
    const existing = await tx.interview.findUnique({
      select: { id: true },
      where: { publicToken: token },
    });

    if (!existing) {
      return token;
    }
  }

  throw new Error("Could not generate a unique interview token.");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
