import type { CandidateScreenListItem } from "../../../src/features/candidate-screens";
import { CandidatesList } from "../../../src/features/candidates-list/candidates-list";
import { getConsoleCandidatesData } from "../../../src/server/dashboard/dashboard-data";
import { parseCandidateListQuery } from "../../../src/server/dashboard/list-query";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseCandidateListQuery(await searchParams);
  const data = await getConsoleCandidatesData(query);
  const candidates = data.candidates.map(
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
      counts={data.counts}
      nextCursor={data.nextCursor}
      organizationName={data.organizationName}
      previousCursor={data.previousCursor}
    />
  );
}
