import "server-only";

import { prisma, type Prisma } from "@prelude/db";

const candidateSessionSpineInclude = {
  candidateBrief: true,
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
} satisfies Prisma.CandidateSessionInclude;

export type CandidateSessionSpine = Prisma.CandidateSessionGetPayload<{
  include: typeof candidateSessionSpineInclude;
}>;

export async function listCandidateSessionSpinesForOrganization({
  organizationId,
  take,
}: {
  organizationId: string;
  take?: number;
}) {
  return prisma.candidateSession.findMany({
    include: candidateSessionSpineInclude,
    orderBy: { updatedAt: "desc" },
    take,
    where: { organizationId },
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
