import { recruiterLimitationCopy } from "@prelude/core";

import {
  DashboardActiveRoles,
  type DashboardActiveRole,
} from "../../src/features/dashboard/dashboard-active-roles";
import { DashboardKpiStrip } from "../../src/features/dashboard/dashboard-kpi-strip";
import {
  DashboardNextActionCard,
  type DashboardNextAction,
} from "../../src/features/dashboard/dashboard-next-action-card";
import { DashboardPageHeader } from "../../src/features/dashboard/dashboard-page-header";
import {
  DashboardReviewQueue,
  type DashboardReviewQueueRow,
} from "../../src/features/dashboard/dashboard-review-queue";
import { getConsoleAuthContext } from "../../src/server/auth/console-auth";
import { getConsoleDashboardData } from "../../src/server/dashboard/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const [dashboard, account] = await Promise.all([
    getConsoleDashboardData(),
    getConsoleAuthContext(),
  ]);
  const reviewTarget = dashboard.primaryReviewHref ?? "/roles/new";
  const reviewRows = dashboard.reviewQueue.slice(0, 6).map(
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
    }),
  );
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
  const nextAction = getNextAction({
    needsReview: dashboard.metrics.needsReview,
    published: dashboard.metrics.published,
    reviewTarget,
  });

  return (
    <>
      <DashboardPageHeader
        needsReviewCount={dashboard.metrics.needsReview}
        organizationName={dashboard.organization.name}
        userName={account.userName}
      />

      <DashboardKpiStrip metrics={dashboard.metrics} />

      <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,360px)] xl:items-start">
        <div className="min-w-0 space-y-5">
          <DashboardReviewQueue
            guardrailCopy={recruiterLimitationCopy}
            rows={reviewRows}
          />
          <DashboardActiveRoles roles={activeRoles} />
        </div>

        <aside className="space-y-4 xl:sticky xl:top-9">
          <DashboardNextActionCard
            action={nextAction}
            metrics={dashboard.metrics}
          />
        </aside>
      </section>
    </>
  );
}

function getNextAction({
  needsReview,
  published,
  reviewTarget,
}: {
  needsReview: number;
  published: number;
  reviewTarget: string;
}): DashboardNextAction {
  if (needsReview > 0) {
    return {
      description:
        "Start with completed sessions. They already have screening signals ready for recruiter review.",
      href: reviewTarget,
      label: "Open review queue",
      title: "Review candidate signals",
    };
  }

  if (published > 0) {
    return {
      description:
        "Published role screens are collecting first-screening evidence. Open the latest role to share or inspect the candidate link.",
      href: reviewTarget,
      label: "Open latest role",
      title: "Invite candidates",
    };
  }

  return {
    description:
      "Create the first role screen from a job brief, then publish the candidate link.",
    href: "/roles/new",
    label: "Create role screen",
    title: "Prepare first role",
  };
}
