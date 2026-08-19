"use server";

import { createHash, randomBytes } from "node:crypto";

import {
  CANDIDATE_PREVIEW_SCHEMA_VERSION,
  candidateExperiencePreviewSnapshotSchema,
  parseStoredInterviewPlan,
} from "@prelude/contracts";
import {
  candidatePreviewAccessExpiresAt,
  candidatePreviewPolicy,
} from "@prelude/core";
import { prisma, type Prisma } from "@prelude/db";

import { canManageRoles } from "../../domain/organization-permissions";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type CreateCandidateExperiencePreviewResult =
  | {
      expiresAt: string;
      ok: true;
      previewUrl: string;
    }
  | { error: string; ok: false };

const cleanupBatchSize = 50;

export async function createCandidateExperiencePreview(
  draftId: string,
): Promise<CreateCandidateExperiencePreviewResult> {
  const normalizedDraftId = draftId.trim();
  if (!normalizedDraftId) {
    return { error: "Save the draft before previewing it.", ok: false };
  }

  const scope = await getCompletedOrganizationScope();
  if (!canManageRoles(scope.role)) {
    return {
      error: "You do not have permission to preview this role.",
      ok: false,
    };
  }

  const now = new Date();
  const candidateOrigin = candidateAppOrigin();
  const expiresAt = candidatePreviewAccessExpiresAt(now);
  const rawToken = `pvtk_${randomBytes(32).toString("base64url")}`;
  const tokenDigest = digestPreviewToken(rawToken);
  const previewId = `pv_${randomBytes(18).toString("base64url")}`;

  const result = await prisma.$transaction(async (tx) => {
    await cleanupExpiredPreviews(tx, now);

    const draft = await tx.interviewDraft.findFirst({
      include: { job: true, organization: true },
      where: {
        id: normalizedDraftId,
        organizationId: scope.organizationId,
      },
    });
    if (!draft) {
      return null;
    }

    const plan = parseStoredInterviewPlan({
      criteria: draft.criteria,
      estimatedMinutes: draft.estimatedMinutes,
      focus: draft.focus,
      guardrails: draft.guardrails,
      // The preview snapshot is the ONLY plan payload the Go store reads for a
      // `pv_` session, so the draft's language stamp has to ride along with it
      // (plan 2026-08-18, rule 7). Passed honestly, null included: resolving it
      // here would claim a language the questions were never written in.
      language: draft.language,
      questions: draft.questions,
      rationale: draft.rationale ?? "",
      responseModes: draft.responseModes,
      roleBrief: draft.roleBrief,
      roleTitle: draft.roleTitle,
      schemaVersion: draft.schemaVersion,
      seniority: draft.seniority,
    });
    const snapshot = candidateExperiencePreviewSnapshotSchema.parse({
      companyName: draft.organization.name,
      jobId: draft.jobId,
      jobTitle: draft.job.title,
      plan,
      schemaVersion: CANDIDATE_PREVIEW_SCHEMA_VERSION,
    });

    return tx.candidateExperiencePreview.create({
      data: {
        createdByUserId: scope.userId,
        draftId: draft.id,
        expiresAt,
        id: previewId,
        liveTestCount: 0,
        organizationId: scope.organizationId,
        runtimeExpiresAt: null,
        schemaVersion: CANDIDATE_PREVIEW_SCHEMA_VERSION,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        tokenDigest,
      },
    });
  });

  if (!result) {
    return { error: "Interview draft not found.", ok: false };
  }

  return {
    expiresAt: expiresAt.toISOString(),
    ok: true,
    previewUrl: new URL(`/preview/${rawToken}`, candidateOrigin).toString(),
  };
}

function digestPreviewToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

async function cleanupExpiredPreviews(tx: Prisma.TransactionClient, now: Date) {
  const cleanupCutoff = new Date(
    now.getTime() - candidatePreviewPolicy.cleanupGraceMs,
  );
  const expired = await tx.candidateExperiencePreview.findMany({
    select: { id: true },
    take: cleanupBatchSize,
    where: {
      OR: [
        { runtimeExpiresAt: { lt: cleanupCutoff } },
        { runtimeExpiresAt: null, expiresAt: { lt: cleanupCutoff } },
      ],
    },
  });
  const previewIds = expired.map((preview) => preview.id);
  if (previewIds.length === 0) {
    return;
  }

  /*
   * `LiveInterviewRecording.session` is ON DELETE RESTRICT, not Cascade: a
   * recording row is the only handle on an audio object in R2, so cascading it
   * away on a session delete would leave the audio behind with nothing pointing
   * at it. Postgres therefore REFUSES to delete a session that still has
   * recordings — and this cleanup runs inside the transaction that creates a
   * preview, so an unfiltered delete would not merely skip a row: it would fail
   * the recruiter's preview creation with a foreign-key error.
   *
   * A preview is never recorded (the realtime service returns early for preview
   * sessions before starting any egress), so this should select nothing. It is
   * here so that if that ever changes, the consequence is one preview kept and
   * one loud log — not a broken button and a wedged cleanup.
   *
   * Both deletes drop the blocked ids: keeping the snapshot alongside its session
   * leaves the pair resolvable, which is what the erasure path needs to reach the
   * audio that is still out there.
   */
  const blocked = await tx.liveInterviewSession.findMany({
    select: { interviewPlanId: true },
    where: {
      interviewPlanId: { in: previewIds },
      kind: "preview",
      recordings: { some: {} },
    },
  });
  if (blocked.length > 0) {
    const blockedIds = blocked.map((session) => session.interviewPlanId);
    console.error(
      "[candidate-preview-cleanup] expired previews kept: their sessions still hold recordings, whose audio must be erased through the realtime erasure path first",
      { previewIds: blockedIds },
    );
    const blockedSet = new Set(blockedIds);
    const purgeableIds = previewIds.filter((id) => !blockedSet.has(id));
    if (purgeableIds.length === 0) {
      return;
    }
    await deleteExpiredPreviews(tx, purgeableIds);
    return;
  }

  await deleteExpiredPreviews(tx, previewIds);
}

async function deleteExpiredPreviews(
  tx: Prisma.TransactionClient,
  previewIds: string[],
) {
  await tx.liveInterviewSession.deleteMany({
    where: {
      interviewPlanId: { in: previewIds },
      kind: "preview",
    },
  });
  await tx.candidateExperiencePreview.deleteMany({
    where: { id: { in: previewIds } },
  });
}

function candidateAppOrigin() {
  const configured =
    process.env.NEXT_PUBLIC_CANDIDATE_URL ?? "http://localhost:3001";
  const url = new URL(configured);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("NEXT_PUBLIC_CANDIDATE_URL must use HTTP or HTTPS.");
  }
  if (process.env.APP_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_CANDIDATE_URL must use HTTPS in production.");
  }
  return url.origin;
}
