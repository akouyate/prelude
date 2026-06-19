import {
  liveInterviewRecruiterSummaryWireSchema,
  type LiveInterviewRecruiterSummary,
} from "@prelude/contracts";
import { EnterpriseShell } from "@prelude/ui";

import { ConsoleAuthControls } from "../../../src/features/auth/console-auth-controls";
import { mockRecruiterSummary } from "../../../src/features/interview-agent/mock-recruiter-summary";
import { RecruiterSummaryPanel } from "../../../src/features/interview-agent/recruiter-summary-panel";
import { isClerkConfigured } from "../../../src/server/auth/clerk-config";
import { getConsoleAuthContext } from "../../../src/server/auth/console-auth";
import { requireCompletedOrganizationOnboarding } from "../../../src/server/onboarding/onboarding-guard";

type InterviewDetailPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

const realtimeApiUrl =
  process.env.PRELUDE_REALTIME_API_URL ??
  process.env.REALTIME_API_URL ??
  "http://127.0.0.1:8080";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InterviewDetailPage({
  params,
}: InterviewDetailPageProps) {
  await requireCompletedOrganizationOnboarding();

  const { sessionId } = await params;
  const [account, result] = await Promise.all([
    getConsoleAuthContext(),
    fetchRecruiterSummary(sessionId),
  ]);
  const summary = result.summary ?? {
    ...mockRecruiterSummary,
    sessionId,
  };

  return (
    <EnterpriseShell
      account={account}
      accountActions={<ConsoleAuthControls enabled={isClerkConfigured} />}
    >
      {result.error ? (
        <p className="mx-auto mb-3 w-full max-w-6xl text-xs text-ink-500">
          Preview data shown because the realtime summary is unavailable.
        </p>
      ) : null}
      <RecruiterSummaryPanel summary={summary} />
    </EnterpriseShell>
  );
}

async function fetchRecruiterSummary(sessionId: string): Promise<
  | {
      summary: LiveInterviewRecruiterSummary;
      error?: never;
    }
  | {
      summary?: never;
      error: string;
    }
> {
  try {
    const response = await fetch(
      `${realtimeApiUrl}/v1/interview-sessions/${sessionId}/summary`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      return {
        error: `Realtime API returned ${response.status} for session ${sessionId}.`,
      };
    }

    const body = (await response.json()) as { summary?: unknown };
    const parsed = liveInterviewRecruiterSummaryWireSchema.safeParse(
      body.summary,
    );

    if (!parsed.success) {
      return {
        error: "Realtime API returned an invalid recruiter summary payload.",
      };
    }

    return { summary: parsed.data };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Realtime API could not be reached.",
    };
  }
}
