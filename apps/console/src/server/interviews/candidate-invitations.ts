import "server-only";

import { randomBytes } from "node:crypto";

import {
  normalizeCandidateLifecycleStatus,
  type CandidateLifecycleStatus,
} from "@prelude/core";
import { prisma, type Prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

const DEFAULT_CANDIDATE_INVITATION_TTL_DAYS = 30;
const reissuableInvitationStatuses = new Set<CandidateLifecycleStatus>([
  "expired",
  "failed",
]);
const immutableInvitationStatuses = new Set<CandidateLifecycleStatus>([
  "completed",
  "superseded",
]);

export type CandidateInvitationSummary = {
  candidateEmail: string | null;
  candidateLabel: string;
  candidateName: string | null;
  candidatePath: string;
  consentedAt: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  latestCandidateSessionHref: string | null;
  latestCandidateSessionStatus: string | null;
  openedAt: string | null;
  sessionCount: number;
  status: CandidateLifecycleStatus;
  token: string;
};

export type CandidateInvitationMutationResult =
  | {
      invitation: CandidateInvitationSummary;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    };

export async function createCandidateInvitationForInterview({
  actorRole,
  candidateEmail,
  candidateName,
  expiresAt,
  interviewId,
  organizationId,
}: {
  actorRole: OrganizationRole;
  candidateEmail?: string | null;
  candidateName?: string | null;
  expiresAt?: Date | null;
  interviewId: string;
  organizationId: string;
}): Promise<CandidateInvitationMutationResult> {
  const accessError = validateInvitationAccess(actorRole);
  if (accessError) {
    return { error: accessError, ok: false };
  }

  const interview = await prisma.interview.findFirst({
    select: {
      id: true,
      jobId: true,
      organizationId: true,
      status: true,
    },
    where: {
      id: interviewId,
      organizationId,
    },
  });

  if (!interview) {
    return {
      error: "Published role screen was not found for this workspace.",
      ok: false,
    };
  }

  if (interview.status !== "published") {
    return {
      error: "Publish this role screen before inviting candidates.",
      ok: false,
    };
  }

  const now = new Date();
  const invitation = await prisma.candidateInvitation.create({
    data: {
      candidateEmail: normalizeOptionalEmail(candidateEmail),
      candidateName: normalizeOptionalText(candidateName),
      expiresAt: normalizeExpiry(expiresAt, now),
      interviewId: interview.id,
      jobId: interview.jobId,
      organizationId: interview.organizationId,
      status: "invited",
      token: await createCandidateInvitationToken(prisma),
    },
  });

  return {
    invitation: toCandidateInvitationSummary(invitation),
    ok: true,
  };
}

export async function reissueCandidateInvitation({
  actorRole,
  invitationId,
  organizationId,
}: {
  actorRole: OrganizationRole;
  invitationId: string;
  organizationId: string;
}): Promise<CandidateInvitationMutationResult> {
  const accessError = validateInvitationAccess(actorRole);
  if (accessError) {
    return { error: accessError, ok: false };
  }

  return prisma.$transaction(async (tx) => {
    const source = await tx.candidateInvitation.findFirst({
      include: {
        interview: {
          select: {
            id: true,
            jobId: true,
            organizationId: true,
            status: true,
          },
        },
      },
      where: {
        id: invitationId,
        organizationId,
      },
    });

    if (!source) {
      return {
        error: "Invitation was not found for this workspace.",
        ok: false,
      };
    }

    const sourceStatus = resolveCandidateInvitationStatus(source, new Date());

    if (immutableInvitationStatuses.has(sourceStatus)) {
      return {
        error: "Completed or superseded invitations cannot be reissued.",
        ok: false,
      };
    }

    if (!reissuableInvitationStatuses.has(sourceStatus)) {
      return {
        error: "Only expired or failed invitations can be reissued.",
        ok: false,
      };
    }

    if (source.interview.status !== "published") {
      return {
        error: "Publish this role screen before reissuing invitations.",
        ok: false,
      };
    }

    if (sourceStatus === "failed") {
      await tx.candidateInvitation.update({
        data: { status: "superseded" },
        where: { id: source.id },
      });
    } else if (source.status !== "expired") {
      await tx.candidateInvitation.update({
        data: { status: "expired" },
        where: { id: source.id },
      });
    }

    const now = new Date();
    const invitation = await tx.candidateInvitation.create({
      data: {
        candidateEmail: source.candidateEmail,
        candidateName: source.candidateName,
        expiresAt: addDays(now, DEFAULT_CANDIDATE_INVITATION_TTL_DAYS),
        interviewId: source.interview.id,
        jobId: source.interview.jobId,
        organizationId: source.interview.organizationId,
        status: "invited",
        token: await createCandidateInvitationToken(tx),
      },
    });

    return {
      invitation: toCandidateInvitationSummary(invitation),
      ok: true,
    };
  });
}

export async function expireStaleCandidateInvitations({
  interviewId,
  organizationId,
}: {
  interviewId?: string;
  organizationId: string;
}) {
  await prisma.candidateInvitation.updateMany({
    data: { status: "expired" },
    where: {
      expiresAt: { lte: new Date() },
      ...(interviewId ? { interviewId } : {}),
      organizationId,
      status: {
        notIn: ["completed", "expired", "superseded"],
      },
    },
  });
}

export function toCandidateInvitationSummary(
  invitation: {
    candidateEmail: string | null;
    candidateName: string | null;
    candidateSessions?: Array<{
      id: string;
      realtimeSessionId: string | null;
      status: string;
    }>;
    consentedAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
    id: string;
    openedAt: Date | null;
    status: string;
    token: string;
  },
  now = new Date(),
): CandidateInvitationSummary {
  const latestSession = invitation.candidateSessions?.[0] ?? null;
  const status = resolveCandidateInvitationStatus(invitation, now);

  return {
    candidateEmail: invitation.candidateEmail,
    candidateLabel: invitation.candidateName
      ? invitation.candidateName
      : invitation.candidateEmail
        ? invitation.candidateEmail
        : "Manual candidate link",
    candidateName: invitation.candidateName,
    candidatePath: buildCandidateInvitationPath(invitation.token),
    consentedAt: invitation.consentedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    id: invitation.id,
    latestCandidateSessionHref: latestSession
      ? `/interviews/${latestSession.realtimeSessionId ?? latestSession.id}`
      : null,
    latestCandidateSessionStatus: latestSession?.status ?? null,
    openedAt: invitation.openedAt?.toISOString() ?? null,
    sessionCount: invitation.candidateSessions?.length ?? 0,
    status,
    token: invitation.token,
  };
}

export function buildCandidateInvitationPath(token: string) {
  return `/interview/${token}`;
}

function validateInvitationAccess(actorRole: OrganizationRole) {
  if (actorRole === "viewer") {
    return "Viewer role cannot invite candidates.";
  }

  return null;
}

function resolveCandidateInvitationStatus(
  invitation: {
    expiresAt: Date;
    status: string;
  },
  now: Date,
): CandidateLifecycleStatus {
  const status =
    normalizeCandidateLifecycleStatus(invitation.status) ?? "invited";

  if (
    invitation.expiresAt <= now &&
    status !== "completed" &&
    status !== "superseded"
  ) {
    return "expired";
  }

  return status;
}

async function createCandidateInvitationToken(
  tx: Pick<Prisma.TransactionClient, "candidateInvitation">,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = `ci_${randomBytes(12).toString("base64url")}`;
    const existing = await tx.candidateInvitation.findUnique({
      select: { id: true },
      where: { token },
    });

    if (!existing) {
      return token;
    }
  }

  throw new Error("Could not generate a unique candidate invitation token.");
}

function normalizeExpiry(expiresAt: Date | null | undefined, now: Date) {
  if (expiresAt && expiresAt > now) {
    return expiresAt;
  }

  return addDays(now, DEFAULT_CANDIDATE_INVITATION_TTL_DAYS);
}

function normalizeOptionalEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}
