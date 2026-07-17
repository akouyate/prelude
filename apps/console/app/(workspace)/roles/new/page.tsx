import Link from "next/link";
import { Xmark } from "iconoir-react";

import { InterviewAgentBuilder } from "../../../../src/features/interview-agent/interview-agent-builder";
import { RoleIntakeSourcePicker } from "../../../../src/features/role-intake/role-intake-source-picker";
import { RoleIntakeUploadFlow } from "../../../../src/features/role-intake/role-intake-upload-flow";
import { RoleIntakeUrlFlow } from "../../../../src/features/role-intake/role-intake-url-flow";
import { isRoleIntakeFeatureEnabled } from "../../../../src/domain/role-intake-policy";
import { getInterviewBuilderContext } from "../../../../src/server/interviews/interview-loaders";
import { getCompletedOrganizationScope } from "../../../../src/server/organizations/organization-scope";
import { getRoleIntakeSummary } from "../../../../src/server/role-intakes/role-intake-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NewRoleScreenPageProps = {
  searchParams: Promise<{
    draftId?: string;
    jobId?: string;
    intakeId?: string;
    source?: string;
  }>;
};

export default async function NewRoleScreenPage({
  searchParams,
}: NewRoleScreenPageProps) {
  const params = await searchParams;
  const source =
    params.source === "manual" || params.source === "upload" || params.source === "url"
      ? params.source
      : undefined;

  if (!params.draftId && !params.jobId && !source) {
    return <RoleIntakeSourcePicker importEnabled={isRoleIntakeFeatureEnabled()} />;
  }

  if (source === "upload") {
    const scope = await getCompletedOrganizationScope();
    const intake = params.intakeId
      ? await getRoleIntakeSummary(scope, params.intakeId)
      : null;
    return <RoleIntakeUploadFlow initialIntake={intake?.ok ? intake.value : undefined} />;
  }

  if (source === "url") {
    const scope = await getCompletedOrganizationScope();
    const intake = params.intakeId
      ? await getRoleIntakeSummary(scope, params.intakeId)
      : null;
    return <RoleIntakeUrlFlow initialIntake={intake?.ok ? intake.value : undefined} />;
  }

  const context = await getInterviewBuilderContext({
    draftId: params.draftId,
    jobId: params.jobId,
  });

  return (
    <>
      <Link
        className="fixed right-5 top-5 z-40 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/82 px-4 text-sm font-medium text-ink-900 backdrop-blur transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6] sm:right-8"
        href="/roles"
      >
        <Xmark aria-hidden="true" className="h-4 w-4" />
        Exit
      </Link>
      <InterviewAgentBuilder
        companyName={context.companyName}
        initialDraft={context.initialDraft}
        initialJobDescription={context.initialJob?.description}
        initialJobId={context.initialJob?.id}
        initialJobLocation={context.initialJob?.location ?? undefined}
        initialJobTitle={context.initialJob?.title}
      />
    </>
  );
}
