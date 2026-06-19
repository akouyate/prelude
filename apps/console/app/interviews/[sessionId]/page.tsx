import Link from "next/link";
import { notFound } from "next/navigation";
import {
  liveInterviewRecruiterSummaryWireSchema,
  type LiveInterviewRecruiterSummary,
} from "@prelude/contracts";
import { Badge, Card, EnterpriseShell } from "@prelude/ui";
import {
  ArrowLeft,
  Community,
  Link as LinkIcon,
  Microphone,
  ShieldCheck,
} from "iconoir-react";

import { ConsoleAuthControls } from "../../../src/features/auth/console-auth-controls";
import { RecruiterSummaryPanel } from "../../../src/features/interview-agent/recruiter-summary-panel";
import { isClerkConfigured } from "../../../src/server/auth/clerk-config";
import { getConsoleAuthContext } from "../../../src/server/auth/console-auth";
import { getInterviewDetail } from "../../../src/server/interviews/interview-loaders";
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
  const [account, detail] = await Promise.all([
    getConsoleAuthContext(),
    getInterviewDetail(sessionId),
  ]);

  if (!detail) {
    notFound();
  }

  const summaryResult =
    detail.kind === "candidate_session" &&
    detail.candidateSession.realtimeSessionId
      ? await fetchRecruiterSummary(detail.candidateSession.realtimeSessionId)
      : null;

  return (
    <EnterpriseShell
      account={account}
      accountActions={<ConsoleAuthControls enabled={isClerkConfigured} />}
      className="bg-[#fbfaf7]"
    >
      {detail.kind === "interview" ? (
        <InterviewOverview detail={detail} />
      ) : summaryResult?.summary ? (
        <RecruiterSummaryPanel summary={summaryResult.summary} />
      ) : (
        <CandidateSessionPending
          error={summaryResult?.error}
          session={detail.candidateSession}
        />
      )}
    </EnterpriseShell>
  );
}

function InterviewOverview({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getInterviewDetail>>> & {
    kind: "interview";
  };
}) {
  const { interview } = detail;

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-sm font-medium text-ink-600 transition hover:text-ink-950"
        href="/"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Dashboard
      </Link>

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <Badge className={statusBadgeClass(interview.status)}>
            {formatStatus(interview.status)}
          </Badge>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal text-ink-950">
            {interview.roleTitle}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-600">
            {interview.roleBrief || "No role brief has been added yet."}
          </p>
        </div>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <LinkIcon aria-hidden="true" className="h-4 w-4" />
            Candidate link
          </div>
          <p className="mt-3 break-all text-base font-semibold text-ink-950">
            prelude.ai{interview.candidatePath}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-500">
            Snapshot published from the saved draft. Candidate sessions will
            appear here once started.
          </p>
        </Card>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Microphone aria-hidden="true" className="h-4 w-4" />
            Questions
          </div>
          <div className="mt-4 divide-y divide-ink-100">
            {interview.questions.map((question, index) => (
              <div key={question.id} className="py-4 first:pt-0 last:pb-0">
                <p className="text-xs font-semibold text-ink-400">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <p className="mt-1 text-sm font-semibold leading-6 text-ink-950">
                  {question.prompt}
                </p>
                <p className="mt-1 text-sm leading-5 text-ink-500">
                  {question.signal}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              Evaluation
            </div>
            <div className="mt-4 space-y-3">
              {interview.criteria.map((criterion) => (
                <div key={criterion.id}>
                  <p className="text-sm font-semibold text-ink-950">
                    {criterion.label}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-ink-500">
                    {criterion.description}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Community aria-hidden="true" className="h-4 w-4" />
              Candidate sessions
            </div>
            <div className="mt-4 space-y-3">
              {interview.candidateSessions.length > 0 ? (
                interview.candidateSessions.map((session) => (
                  <Link
                    key={session.id}
                    className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-ink-100 bg-white/72 px-4 py-3 text-sm transition hover:border-ink-300"
                    href={`/interviews/${session.realtimeSessionId ?? session.id}`}
                  >
                    <span className="font-medium text-ink-900">
                      {formatStatus(session.status)}
                    </span>
                    <span className="text-ink-500">
                      {formatDate(session.startedAt)}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="text-sm leading-6 text-ink-500">
                  No candidate has started this interview yet.
                </p>
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

function CandidateSessionPending({
  error,
  session,
}: {
  error?: string;
  session: {
    realtimeSessionId: string | null;
    roleTitle: string;
    status: string;
  };
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-sm font-medium text-ink-600 transition hover:text-ink-950"
        href="/"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back
      </Link>
      <Card className="mt-6 p-6">
        <Badge className={statusBadgeClass(session.status)}>
          {formatStatus(session.status)}
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold text-ink-950">
          {session.roleTitle}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          {error ??
            "The recruiter summary is not available yet. It will appear once the live interview has enough completed data."}
        </p>
      </Card>
    </div>
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

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not started";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusBadgeClass(status: string) {
  if (status === "completed" || status === "needs_review") {
    return "bg-coral-50 text-coral-800";
  }

  if (status === "published") {
    return "bg-ink-900 text-white";
  }

  if (status === "in_progress" || status === "waiting_candidate") {
    return "bg-gold-100 text-gold-800";
  }

  return "bg-[#f0f1e6] text-olive-800";
}
