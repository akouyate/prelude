import { recruiterLimitationCopy } from "@prelude/core";

import {
  DashboardActiveRoles,
  type DashboardActiveRole,
} from "../../src/features/dashboard/dashboard-active-roles";
import { DashboardPageHeader } from "../../src/features/dashboard/dashboard-page-header";
import {
  DashboardReviewQueue,
  type DashboardReviewQueueRow,
} from "../../src/features/dashboard/dashboard-review-queue";
import { getConsoleAuthContext } from "../../src/server/auth/console-auth";
import { getConsoleDashboardData } from "../../src/server/dashboard/dashboard-data";
import {
  candidateReviewStaleAfterDays,
  candidateWaitingDays,
} from "../../src/domain/candidate-review-policy";
import { updateCandidateReviewStatusAction } from "../../src/server/interviews/candidate-review-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const [dashboard, account] = await Promise.all([
    getConsoleDashboardData(),
    getConsoleAuthContext(),
  ]);
  const now = Date.now();
  const reviewRows = dashboard.reviewQueue.map(
    (session): DashboardReviewQueueRow => ({
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
      waitingDays: candidateWaitingDays(
        session.completedAt ?? session.startedAt,
        now,
      ),
    }),
  );
  const staleCount = reviewRows.filter(
    (row) =>
      row.reviewStatus === "to_review" &&
      row.waitingDays >= candidateReviewStaleAfterDays,
  ).length;
  const activeRoles = dashboard.roles.map(
    (role): DashboardActiveRole => ({
      candidateCount: role.candidateCount,
      href: role.href,
      id: role.id,
      location: role.location,
      sourceProvider: role.sourceProvider,
      state: role.state,
      title: role.title,
    }),
  );

  return (
    <>
      <DashboardPageHeader
        needsReviewCount={dashboard.metrics.needsReview}
        organizationName={dashboard.organization.name}
        staleAfterDays={candidateReviewStaleAfterDays}
        staleCount={staleCount}
        stats={{
          activeRoles: dashboard.metrics.activeRoles,
          completed: dashboard.metrics.completed,
          drafts: dashboard.metrics.drafts,
          published: dashboard.metrics.published,
        }}
        userName={account.userName}
      />

      <DashboardReviewQueue
        guardrailCopy={recruiterLimitationCopy}
        onStatusChange={updateCandidateReviewStatusAction}
        rows={reviewRows}
        staleAfterDays={candidateReviewStaleAfterDays}
        staleCount={staleCount}
      />

      <DashboardActiveRoles
        roles={activeRoles}
        totalCount={dashboard.metrics.activeRoles}
      />
    </>
  );
}
