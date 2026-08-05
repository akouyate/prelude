import "server-only";

import { prisma } from "@prelude/db";

import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type WorkspaceNavCounts = {
  candidates: number;
  roles: number;
};

/**
 * Badge counts for the workspace sidebar. Kept to two `count()` queries so it
 * can run in the layout on every workspace navigation: unlike the dashboard
 * loader it does not overlay realtime session status, so the candidate badge
 * reads persisted review state only.
 */
export async function getWorkspaceNavCounts(): Promise<WorkspaceNavCounts> {
  const scope = await getCompletedOrganizationScope();
  const [roles, candidates] = await Promise.all([
    prisma.job.count({ where: { organizationId: scope.organizationId } }),
    prisma.candidateSession.count({
      where: {
        organizationId: scope.organizationId,
        reviewStatus: "to_review",
        status: "completed",
      },
    }),
  ]);

  return { candidates, roles };
}
