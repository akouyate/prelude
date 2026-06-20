import Link from "next/link";
import { Xmark } from "iconoir-react";

import { InterviewAgentBuilder } from "../../../../src/features/interview-agent/interview-agent-builder";
import { getInterviewBuilderContext } from "../../../../src/server/interviews/interview-loaders";
import { requireCompletedOrganizationOnboarding } from "../../../../src/server/onboarding/onboarding-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NewInterviewPageProps = {
  searchParams: Promise<{
    draftId?: string;
    jobId?: string;
  }>;
};

export default async function NewInterviewPage({
  searchParams,
}: NewInterviewPageProps) {
  await requireCompletedOrganizationOnboarding();

  const params = await searchParams;
  const context = await getInterviewBuilderContext({
    draftId: params.draftId,
    jobId: params.jobId,
  });

  return (
    <>
      <Link
        className="fixed right-5 top-20 z-20 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/80 px-4 text-sm font-medium text-ink-900 backdrop-blur transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6] sm:right-8"
        href="/"
      >
        <Xmark aria-hidden="true" className="h-4 w-4" />
        Exit
      </Link>
      <InterviewAgentBuilder
        companyName={context.companyName}
        initialDraft={context.initialDraft}
        initialJobDescription={context.initialJob?.description}
        initialJobId={context.initialJob?.id}
        initialJobTitle={context.initialJob?.title}
      />
    </>
  );
}
