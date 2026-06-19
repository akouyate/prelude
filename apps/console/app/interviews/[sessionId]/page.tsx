import {
  liveInterviewRecruiterSummaryWireSchema,
  type LiveInterviewRecruiterSummary,
} from "@prelude/contracts";
import { Button, EnterpriseShell } from "@prelude/ui";
import { RefreshCw } from "lucide-react";

import { RecruiterSummaryPanel } from "../../../src/features/interview-agent/recruiter-summary-panel";

type InterviewDetailPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

const realtimeApiUrl =
  process.env.PRELUDE_REALTIME_API_URL ??
  process.env.REALTIME_API_URL ??
  "http://127.0.0.1:8080";

export default async function InterviewDetailPage({
  params,
}: InterviewDetailPageProps) {
  const { sessionId } = await params;
  const result = await fetchRecruiterSummary(sessionId);

  return (
    <EnterpriseShell>
      {result.summary ? (
        <RecruiterSummaryPanel summary={result.summary} />
      ) : (
        <section className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col justify-center">
          <div className="rounded-lg border border-ink-200 bg-white p-6">
            <div className="text-sm font-medium text-ink-500">
              Interview recap
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-ink-900">
              Recruiter summary is not ready
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-600">
              The interview detail page is available, but the realtime service
              could not return a recruiter summary for this session.
            </p>
            <p className="mt-2 text-sm text-ink-500">{result.error}</p>
            <form action="" className="mt-5">
              <Button type="submit">
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Retry
              </Button>
            </form>
          </div>
        </section>
      )}
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
