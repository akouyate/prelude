import type { CandidateScreenListItem } from "../../../src/features/candidate-screens";
import { CandidatesList } from "../../../src/features/candidates-list/candidates-list";
import { getConsoleDashboardData } from "../../../src/server/dashboard/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CandidatesPage() {
  const dashboard = await getConsoleDashboardData();
  const candidates = dashboard.reviewQueue.map(
    (session): CandidateScreenListItem => ({
      analysisStatus: session.analysisStatus,
      candidateLabel: session.candidateLabel,
      completedAt: session.completedAt,
      criteriaDistribution: session.criteriaDistribution,
      hasCompletedBrief: session.hasCompletedBrief,
      href: session.href,
      id: session.id,
      jobTitle: session.jobTitle,
      pointsToClarifyCount: session.pointsToClarifyCount,
      questionCompletionRate: session.questionCompletionRate,
      reviewStatus: session.reviewStatus,
      roleTitle: session.roleTitle,
      startedAt: session.startedAt,
      status: session.status,
    }),
  );

  return (
    <CandidatesList
      candidates={candidates}
      organizationName={dashboard.organization.name}
    />
  );
}
