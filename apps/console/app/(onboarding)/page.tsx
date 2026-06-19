import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle,
  Community,
  Microphone,
  Plus,
  Suitcase,
} from "iconoir-react";
import { Badge, Card, cn } from "@prelude/ui";

import { getConsoleDashboardData } from "../../src/server/dashboard/dashboard-data";
import { requireCompletedOrganizationOnboarding } from "../../src/server/onboarding/onboarding-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  await requireCompletedOrganizationOnboarding();

  const dashboard = await getConsoleDashboardData();
  const primaryJob = dashboard.jobs[0];
  const draftCount = dashboard.jobs.filter((job) => job.status === "draft").length;

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
            {primaryJob ? (
              <Link
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/70 px-5 text-sm font-medium text-ink-900 transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                href={`/interviews/demo-session?jobId=${primaryJob.id}`}
              >
                Review latest
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>

        <Card className="p-5">
          <p className="text-sm font-medium text-ink-500">Workspace setup</p>
          <dl className="mt-5 space-y-4">
            <DashboardFact
              label="Company size"
              value={dashboard.organization.companySize ?? "Not set"}
            />
            <DashboardFact
              label="Hiring focus"
              value={dashboard.organization.hiringFocus ?? "Not set"}
            />
            <DashboardFact
              label="Default mode"
              value={dashboard.organization.defaultInterviewMode ?? "Not set"}
            />
          </dl>
        </Card>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Suitcase aria-hidden="true" className="h-5 w-5" />}
          label="Active roles"
          value={dashboard.jobs.length.toString()}
        />
        <MetricCard
          icon={<Microphone aria-hidden="true" className="h-5 w-5" />}
          label="Draft interviews"
          value={draftCount.toString()}
        />
        <MetricCard
          icon={<Community aria-hidden="true" className="h-5 w-5" />}
          label="Candidate reviews"
          value="0"
        />
      </section>

      <section className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-ink-950">Roles</h2>
              <p className="mt-1 text-sm text-ink-500">
                Start from the jobs imported or created during onboarding.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {dashboard.jobs.length > 0 ? (
              dashboard.jobs.map((job) => (
                <Link
                  key={job.id}
                  className="group flex cursor-pointer items-center justify-between gap-5 rounded-2xl border border-ink-100 bg-white/70 p-4 transition hover:border-ink-300 hover:bg-white"
                  href={`/interviews/demo-session?jobId=${job.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-ink-950">
                      {job.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                      <span>{job.location ?? "Location not set"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatProvider(job.sourceProvider)}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Badge className={statusBadgeClass(job.status)}>
                      {formatStatus(job.status)}
                    </Badge>
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
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f0f1e6] text-olive-800">
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
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink-950">{value}</dd>
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

function formatProvider(provider: string | null) {
  if (!provider) {
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

function statusBadgeClass(status: string) {
  return cn(
    status === "draft"
      ? "bg-[#f0f1e6] text-olive-800"
      : "bg-ink-100 text-ink-700",
  );
}
