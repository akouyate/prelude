import Link from "next/link";
import { Xmark } from "iconoir-react";

import { InterviewAgentBuilder } from "../../../../src/features/interview-agent/interview-agent-builder";
import { getConsoleDashboardData } from "../../../../src/server/dashboard/dashboard-data";
import { requireCompletedOrganizationOnboarding } from "../../../../src/server/onboarding/onboarding-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewInterviewPage() {
  await requireCompletedOrganizationOnboarding();

  const dashboard = await getConsoleDashboardData();
  const firstJob = dashboard.jobs[0];

  return (
    <>
      <Link
        className="fixed right-5 top-20 z-20 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/80 px-4 text-sm font-medium text-ink-900 shadow-soft backdrop-blur transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6] sm:right-8"
        href="/"
      >
        <Xmark aria-hidden="true" className="h-4 w-4" />
        Exit
      </Link>
      <InterviewAgentBuilder
        companyName={dashboard.organization.name}
        initialJobDescription={firstJob ? firstJob.description : undefined}
        initialJobTitle={firstJob?.title}
      />
    </>
  );
}
