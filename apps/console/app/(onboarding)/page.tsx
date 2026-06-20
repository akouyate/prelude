import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  Clock,
  Community,
  Microphone,
  Plus,
  ShieldCheck,
  Suitcase,
  WarningTriangle,
} from "iconoir-react";
import { Card, StatusBadge } from "@prelude/ui";

import { getConsoleDashboardData } from "../../src/server/dashboard/dashboard-data";
import { requireCompletedOrganizationOnboarding } from "../../src/server/onboarding/onboarding-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  await requireCompletedOrganizationOnboarding();

  const dashboard = await getConsoleDashboardData();
  const hasReviewTarget = Boolean(dashboard.primaryReviewHref);
  const reviewCtaLabel =
    dashboard.metrics.needsReview > 0 ? "Review latest" : "Open latest role";
  const nextAction =
    dashboard.metrics.needsReview > 0
      ? {
          description:
            "Start with completed sessions. They already have screening signals ready for recruiter review.",
          href: dashboard.primaryReviewHref ?? "/",
          label: "Open review queue",
          title: "Review candidate signals",
        }
      : dashboard.metrics.published > 0
        ? {
            description:
              "Share a live interview link and let Prelude collect first-screening signals.",
            href: dashboard.primaryReviewHref ?? "/interviews/new",
            label: "Open latest role",
            title: "Invite candidates",
          }
        : {
            description:
              "Create the first interview draft from a job brief, then publish the candidate link.",
            href: "/interviews/new",
            label: "Create interview",
            title: "Prepare first role",
          };

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-14 pt-8 sm:px-8">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div>
          <p className="text-sm font-medium text-ink-500">
            {dashboard.organization.name}
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal text-ink-950 sm:text-5xl">
            Recruiter workspace
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-ink-600">
            Keep first-screening work focused: prepare interviews, review
            candidate signals, and move only qualified profiles forward.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-5 text-sm font-medium text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
              href="/interviews/new"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              New interview
            </Link>
            {hasReviewTarget ? (
              <Link
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/70 px-5 text-sm font-medium text-ink-900 transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                href={dashboard.primaryReviewHref!}
              >
                {reviewCtaLabel}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>

        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive-900">
            Next best action
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-ink-950">
            {nextAction.title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-ink-600">
            {nextAction.description}
          </p>
          <dl className="mt-5 grid grid-cols-3 gap-2">
            <DashboardFact
              label="Review"
              value={dashboard.metrics.needsReview.toString()}
            />
            <DashboardFact
              label="Live"
              value={dashboard.metrics.published.toString()}
            />
            <DashboardFact
              label="Drafts"
              value={dashboard.metrics.drafts.toString()}
            />
          </dl>
          <Link
            className="mt-5 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-4 text-sm font-medium text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
            href={nextAction.href}
          >
            {nextAction.label}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Card>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Suitcase aria-hidden="true" className="h-5 w-5" />}
          label="Active roles"
          value={dashboard.metrics.activeRoles.toString()}
        />
        <MetricCard
          icon={<CheckCircle aria-hidden="true" className="h-5 w-5" />}
          label="Completed screens"
          value={dashboard.metrics.completed.toString()}
        />
        <MetricCard
          icon={<Community aria-hidden="true" className="h-5 w-5" />}
          label="Needs review"
          value={dashboard.metrics.needsReview.toString()}
        />
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink-950">Review queue</h2>
            <p className="mt-1 text-sm text-ink-500">
              Real candidate sessions from completed or in-progress live interviews.
            </p>
          </div>
        </div>

        {dashboard.reviewQueue.length > 0 ? (
          <div className="overflow-hidden rounded-3xl border border-ink-100 bg-white/72">
            <div className="divide-y divide-ink-100">
              {dashboard.reviewQueue.map((session) => (
                <Link
                  key={session.id}
                  className="group grid cursor-pointer gap-4 p-4 transition hover:bg-white sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center"
                  href={session.href}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-semibold text-ink-950">
                        {session.candidateLabel}
                      </span>
                      <StatusBadge tone={reviewStatusTone(session.reviewStatus)}>
                        {formatReviewStatus(session.reviewStatus)}
                      </StatusBadge>
                    </span>
                    <span className="mt-1 block truncate text-sm text-ink-500">
                      {session.roleTitle} · {session.jobTitle}
                    </span>
                  </span>

                  <span className="grid gap-2 text-sm text-ink-600 sm:grid-cols-2">
                    <ReviewFact
                      icon={<Clock aria-hidden="true" className="h-4 w-4" />}
                      label={formatStatus(session.status)}
                    />
                    <ReviewFact
                      icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
                      label={formatAnalysisStatus(session.analysisStatus)}
                    />
                    <ReviewFact
                      icon={<Microphone aria-hidden="true" className="h-4 w-4" />}
                      label={`${session.transcriptTurnCount} turns`}
                    />
                    <ReviewFact
                      icon={<Calendar aria-hidden="true" className="h-4 w-4" />}
                      label={formatShortDate(session.completedAt ?? session.startedAt)}
                    />
                  </span>

                  <span className="flex items-center justify-between gap-3 text-sm font-medium text-ink-900 sm:justify-end">
                    {session.questionCompletionRate === null ? (
                      <span className="text-ink-400">No script</span>
                    ) : (
                      <span>{session.questionCompletionRate}% complete</span>
                    )}
                    <ArrowRight
                      aria-hidden="true"
                      className="h-4 w-4 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-900"
                    />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <Card className="border-dashed bg-white/58 p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef0e3] text-olive-800">
                <WarningTriangle aria-hidden="true" className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink-950">
                  No candidate session yet
                </span>
                <span className="mt-2 block max-w-2xl text-sm leading-6 text-ink-600">
                  Share a published interview link. When a candidate starts the
                  live interview, the real session will appear here with review
                  status and analysis availability.
                </span>
              </span>
            </div>
          </Card>
        )}
      </section>

      <section className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-ink-950">Interviews</h2>
              <p className="mt-1 text-sm text-ink-500">
                Draft, publish, and inspect the interview setup for each role.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {dashboard.interviews.length > 0 ? (
              dashboard.interviews.map((interview) => (
                <Link
                  key={interview.id}
                  className="group flex cursor-pointer items-center justify-between gap-5 rounded-2xl border border-ink-100 bg-white/70 p-4 transition hover:border-ink-300 hover:bg-white"
                  href={interview.href}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-ink-950">
                      {interview.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                      <span>{interview.location ?? "Location not set"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatProvider(interview.sourceProvider)}</span>
                      {interview.candidateCount > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {interview.candidateCount} candidate
                            {interview.candidateCount > 1 ? "s" : ""}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StatusBadge tone={statusTone(interview.state)}>
                      {formatStatus(interview.state)}
                    </StatusBadge>
                    <ArrowRight
                      aria-hidden="true"
                      className="h-4 w-4 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-900"
                    />
                  </span>
                </Link>
              ))
            ) : (
              <Card className="p-6">
                <p className="text-sm font-medium text-ink-900">
                  No role yet
                </p>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  Create the first interview draft to add a role to this
                  workspace.
                </p>
              </Card>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-ink-950">Sources</h2>
          <div className="mt-4 space-y-3">
            {dashboard.connectors.map((connector) => (
              <Card
                key={`${connector.provider}-${connector.status}`}
                className="flex items-center gap-3 p-4"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#eef0e3] text-olive-800">
                  <CheckCircle aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink-950">
                    {formatProvider(connector.provider)}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-500">
                    {formatStatus(connector.status)}
                  </span>
                </span>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function DashboardFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/62 px-3 py-3">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-ink-900 text-white">
          {icon}
        </span>
        <span className="text-3xl font-semibold text-ink-950">{value}</span>
      </div>
      <p className="mt-5 text-sm font-medium text-ink-600">{label}</p>
    </Card>
  );
}

function ReviewFact({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="text-ink-400">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

function formatProvider(provider: string | null) {
  if (!provider || provider === "manual") {
    return "Manual";
  }

  if (provider === "linkedin") {
    return "LinkedIn";
  }

  if (provider === "indeed") {
    return "Indeed";
  }

  return provider.replace(/_/g, " ");
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatReviewStatus(status: string) {
  if (status === "to_call") {
    return "To call";
  }

  if (status === "to_review") {
    return "To review";
  }

  return "Archived";
}

function formatAnalysisStatus(status: string) {
  if (status === "available") {
    return "Analysis ready";
  }

  if (status === "pending") {
    return "Analysis pending";
  }

  return "Not ready";
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "needs_review") {
    return "danger";
  }

  if (status === "candidate_started") {
    return "warning";
  }

  if (status === "published") {
    return "dark";
  }

  if (status === "completed") {
    return "success";
  }

  return "olive";
}

function reviewStatusTone(status: string) {
  if (status === "to_call") {
    return "success";
  }

  if (status === "archived") {
    return "muted";
  }

  return "danger";
}
