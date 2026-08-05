import "server-only";

import { prisma } from "@prelude/db";

export type CandidateSessionSiblings = {
  nextHref: string | null;
  position: number;
  previousHref: string | null;
  total: number;
};

/**
 * Pager context for the candidate review page: the other candidates screened for
 * the same role, most recent interview first. Ordering by interview date keeps a
 * candidate's position stable when an unrelated session is edited — unlike the
 * `updatedAt` order the role list uses. Scoped by organization so the pager can
 * never walk out of the tenant.
 */
export async function getCandidateSessionSiblings({
  candidateSessionId,
  interviewId,
  organizationId,
}: {
  candidateSessionId: string;
  interviewId: string;
  organizationId: string;
}): Promise<CandidateSessionSiblings> {
  const sessions = await prisma.candidateSession.findMany({
    select: {
      completedAt: true,
      createdAt: true,
      id: true,
      realtimeSessionId: true,
      startedAt: true,
    },
    where: { interviewId, organizationId },
  });
  sessions.sort(
    (left, right) => interviewedAt(right) - interviewedAt(left) ||
      // Sessions sharing a timestamp keep a deterministic order.
      left.id.localeCompare(right.id),
  );
  const index = sessions.findIndex(
    (session) => session.id === candidateSessionId,
  );

  if (index === -1) {
    return {
      nextHref: null,
      position: 1,
      previousHref: null,
      total: Math.max(sessions.length, 1),
    };
  }

  return {
    nextHref: detailHref(sessions[index + 1]),
    position: index + 1,
    previousHref: detailHref(sessions[index - 1]),
    total: sessions.length,
  };
}

// The date the candidate was interviewed: when the screen finished, otherwise
// when it started. Sessions that never started fall back to their creation date
// so an invited-but-idle candidate still has a stable slot.
function interviewedAt(session: {
  completedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
}) {
  return (
    session.completedAt ?? session.startedAt ?? session.createdAt
  ).getTime();
}

function detailHref(
  session: { id: string; realtimeSessionId: string | null } | undefined,
) {
  return session ? `/interviews/${session.realtimeSessionId ?? session.id}` : null;
}
