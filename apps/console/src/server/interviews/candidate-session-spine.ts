import "server-only";

import { prisma, type Prisma } from "@prelude/db";

const candidateSessionSpineInclude = {
  candidateBrief: true,
  candidateInvitation: true,
  interview: true,
  job: true,
  reviewNoteUpdatedBy: {
    select: {
      email: true,
      name: true,
    },
  },
  reviewStatusUpdatedBy: {
    select: {
      email: true,
      name: true,
    },
  },
  scheduledCalls: {
    orderBy: { createdAt: "desc" },
    take: 1,
    where: { activeScheduleKey: { not: null } },
  },
} satisfies Prisma.CandidateSessionInclude;

export type CandidateSessionSpine = Prisma.CandidateSessionGetPayload<{
  include: typeof candidateSessionSpineInclude;
}>;

export async function listCandidateSessionSpinesForOrganization({
  cursor,
  orderBy,
  organizationId,
  take,
  where,
}: {
  cursor?: string | null;
  orderBy?: Prisma.CandidateSessionOrderByWithRelationInput[];
  organizationId: string;
  take?: number;
  where?: Prisma.CandidateSessionWhereInput;
}) {
  return prisma.candidateSession.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: candidateSessionSpineInclude,
    orderBy: orderBy ?? [{ updatedAt: "desc" }, { id: "desc" }],
    skip: cursor ? 1 : undefined,
    take,
    where: { organizationId, ...where },
  });
}

export async function findCandidateSessionSpineForOrganization({
  idOrRealtimeSessionId,
  organizationId,
}: {
  idOrRealtimeSessionId: string;
  organizationId: string;
}) {
  return prisma.candidateSession.findFirst({
    include: candidateSessionSpineInclude,
    where: {
      organizationId,
      OR: [
        { id: idOrRealtimeSessionId },
        { realtimeSessionId: idOrRealtimeSessionId },
      ],
    },
  });
}
