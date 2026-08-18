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
    sourceUrl?: string;
  }>;
};

export default async function NewRoleScreenPage({
  searchParams,
}: NewRoleScreenPageProps) {
  const params = await searchParams;
  const source =
    params.source === "manual" ||
    params.source === "upload" ||
    params.source === "url"
      ? params.source
      : undefined;

  if (!params.draftId && !params.jobId && !source) {
    return (
      <RoleIntakeSourcePicker importEnabled={isRoleIntakeFeatureEnabled()} />
    );
  }

  if (source === "upload") {
    const scope = await getCompletedOrganizationScope();
    const intake = params.intakeId
      ? await getRoleIntakeSummary(scope, params.intakeId)
      : null;
    return (
      <RoleIntakeUploadFlow
        initialIntake={intake?.ok ? intake.value : undefined}
      />
    );
  }

  if (source === "url") {
    const scope = await getCompletedOrganizationScope();
    const intake = params.intakeId
      ? await getRoleIntakeSummary(scope, params.intakeId)
      : null;
    return (
      <RoleIntakeUrlFlow
        initialIntake={intake?.ok ? intake.value : undefined}
      />
    );
  }

  const context = await getInterviewBuilderContext({
    draftId: params.draftId,
    jobId: params.jobId,
  });
  const sourceUrl = safePublicSourceUrl(params.sourceUrl);

  return (
    <InterviewAgentBuilder
      companyName={context.companyName}
      defaultInterviewLanguage={context.defaultInterviewLanguage}
      initialDraft={context.initialDraft}
      initialJobDescription={context.initialJob?.description}
      initialJobId={context.initialJob?.id}
      initialJobLocation={context.initialJob?.location ?? undefined}
      initialJobTitle={context.initialJob?.title}
      initialSourceUrl={sourceUrl}
      workspaceLanguage={context.workspaceLanguage}
    />
  );
}

function safePublicSourceUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
