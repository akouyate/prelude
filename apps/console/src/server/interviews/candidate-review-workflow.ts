import "server-only";

import { prisma, type Prisma } from "@prelude/db";
import { type OrganizationRole } from "@prelude/types";

import {
  prepareCandidateReviewUpdate,
  type CandidateReviewUpdatePlan,
} from "../../domain/candidate-review-policy";
import { resolveReviewStatus } from "./live-session-insights";

type ReviewAuthor = {
  email: string;
  name: string | null;
};

type ReviewTarget = {
  id: string;
  reviewNote: string | null;
  reviewStatus: string | null;
};

export type CandidateReviewUpdate = {
  actorRole: OrganizationRole;
  actorUserId: string;
  candidateSessionId: string;
  nextNote: string;
  nextStatus: string;
  organizationId: string;
};

export type CandidateReviewUpdateOutcome = {
  changed: boolean;
  noteChanged: boolean;
  statusChanged: boolean;
};

export async function updateCandidateSessionReview(
  input: CandidateReviewUpdate,
): Promise<CandidateReviewUpdateOutcome> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.candidateSession.findFirst({
      select: {
        id: true,
        reviewNote: true,
        reviewStatus: true,
      },
      where: {
        id: input.candidateSessionId,
        organizationId: input.organizationId,
      },
    });

    if (!target) {
      throw new Error("Candidate session was not found for this organization.");
    }

    const author = await tx.user.findFirst({
      select: {
        email: true,
        name: true,
      },
      where: {
        id: input.actorUserId,
        memberships: {
          some: {
            organizationId: input.organizationId,
            status: "active",
          },
        },
      },
    });

    if (!author) {
      throw new Error("Review author is not active in this organization.");
    }

    return updateCandidateSessionReviewWithTransaction({
      author,
      input,
      target,
      tx,
    });
  });
}

async function updateCandidateSessionReviewWithTransaction({
  author,
  input,
  target,
  tx,
}: {
  author: ReviewAuthor;
  input: CandidateReviewUpdate;
  target: ReviewTarget;
  tx: Prisma.TransactionClient;
}): Promise<CandidateReviewUpdateOutcome> {
  const prepared = prepareCandidateReviewUpdate({
    currentNote: target.reviewNote,
    currentStatus: target.reviewStatus,
    nextNote: input.nextNote,
    nextStatus: input.nextStatus,
    role: input.actorRole,
  });

  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  const { plan } = prepared;

  if (!plan.noteChanged && !plan.statusChanged) {
    return {
      changed: false,
      noteChanged: false,
      statusChanged: false,
    };
  }

  const now = new Date();
  const updateData: Prisma.CandidateSessionUpdateInput = {};

  if (plan.statusChanged) {
    updateData.reviewStatus = plan.normalizedStatus;
    updateData.reviewStatusUpdatedAt = now;
    updateData.reviewStatusUpdatedBy = {
      connect: { id: input.actorUserId },
    };
  }

  if (plan.noteChanged) {
    updateData.reviewNote = plan.normalizedNote;
    updateData.reviewNoteUpdatedAt = now;
    updateData.reviewNoteUpdatedBy = {
      connect: { id: input.actorUserId },
    };
  }

  await tx.candidateSession.update({
    data: updateData,
    where: { id: target.id },
  });

  await tx.candidateSessionReviewEvent.createMany({
    data: buildReviewEvents({
      author,
      input,
      now,
      plan,
      target,
    }),
  });

  return {
    changed: true,
    noteChanged: plan.noteChanged,
    statusChanged: plan.statusChanged,
  };
}

function buildReviewEvents({
  author,
  input,
  now,
  plan,
  target,
}: {
  author: ReviewAuthor;
  input: CandidateReviewUpdate;
  now: Date;
  plan: CandidateReviewUpdatePlan;
  target: ReviewTarget;
}) {
  const events: Prisma.CandidateSessionReviewEventCreateManyInput[] = [];
  const authorLabel = author.name ?? author.email;

  if (plan.statusChanged) {
    events.push({
      authorUserId: input.actorUserId,
      candidateSessionId: target.id,
      createdAt: now,
      eventType: "status_changed",
      nextStatus: plan.normalizedStatus,
      note: `Human review status updated by ${authorLabel}.`,
      organizationId: input.organizationId,
      previousStatus: resolveReviewStatus(target.reviewStatus),
    });
  }

  if (plan.noteChanged) {
    events.push({
      authorUserId: input.actorUserId,
      candidateSessionId: target.id,
      createdAt: now,
      eventType: "note_updated",
      note: plan.normalizedNote,
      organizationId: input.organizationId,
    });
  }

  return events;
}
