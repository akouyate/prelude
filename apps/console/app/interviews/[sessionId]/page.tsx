import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  liveInterviewRecruiterSummaryWireSchema,
  type LiveInterviewRecruiterSummary,
} from "@prelude/contracts";
import { Badge, Card, EnterpriseShell } from "@prelude/ui";
import {
  ArrowLeft,
  Calendar,
  ClipboardCheck,
  Community,
  EditPencil,
  Link as LinkIcon,
  Microphone,
  ShieldCheck,
  UserBadgeCheck as UserRoundCheck,
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
  const sessionStats = getSessionStats(interview.candidateSessions);
  const candidateLinkLabel = `prelude.ai${interview.candidatePath}`;

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-sm font-medium text-ink-600 transition hover:text-ink-950"
        href="/"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Dashboard
      </Link>

      <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={statusBadgeClass(interview.status)}>
              {formatStatus(interview.status)}
            </Badge>
            <Badge className="bg-white text-ink-700">
              {interview.questions.length} questions
            </Badge>
            <Badge className="bg-white text-ink-700">
              {formatModeSummary(interview.responseModes)}
            </Badge>
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal text-ink-950">
            {interview.roleTitle}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-600">
            {interview.roleBrief || "No role brief has been added yet."}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <InsightPill
              icon={<Community aria-hidden="true" className="h-4 w-4" />}
              label="Started"
              value={String(sessionStats.started)}
            />
            <InsightPill
              icon={<UserRoundCheck aria-hidden="true" className="h-4 w-4" />}
              label="Completed"
              value={String(sessionStats.completed)}
            />
            <InsightPill
              icon={<ClipboardCheck aria-hidden="true" className="h-4 w-4" />}
              label="Needs review"
              value={String(sessionStats.needsReview)}
            />
          </div>
        </div>

        <aside className="space-y-3">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <LinkIcon aria-hidden="true" className="h-4 w-4" />
              Candidate link
            </div>
            <p className="mt-3 break-all rounded-2xl border border-ink-100 bg-ink-50 px-3 py-3 text-sm font-semibold text-ink-950">
              {candidateLinkLabel}
            </p>
            <p className="mt-3 text-sm leading-6 text-ink-500">
              Share this link with candidates. Sessions appear below as soon as
              they start the interview.
            </p>
          </Card>
          <div className="flex flex-wrap gap-2">
            {interview.draftId ? (
              <Link
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/80 px-4 text-sm font-medium text-ink-900 transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                href={`/interviews/new?draftId=${interview.draftId}`}
              >
                <EditPencil aria-hidden="true" className="h-4 w-4" />
                Edit
              </Link>
            ) : null}
            <Link
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full bg-ink-900 px-4 text-sm font-medium text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
              href="/interviews/new"
            >
              New interview
            </Link>
          </div>
        </aside>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Microphone aria-hidden="true" className="h-4 w-4" />
              Interview script
            </div>
            <div className="mt-3 space-y-3">
              {interview.questions.map((question, index) => (
                <article
                  key={question.id}
                  className="rounded-3xl border border-ink-100 bg-white/76 p-4 shadow-soft"
                >
                  <div className="flex gap-4">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f0f1e6] text-xs font-semibold text-olive-800">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge className="bg-ink-100 text-ink-700">
                          {formatQuestionSource(question.source)}
                        </Badge>
                        <span className="text-xs font-medium text-ink-400">
                          {Math.round(question.durationSeconds / 60)} min
                        </span>
                      </div>
                      <p className="text-base font-semibold leading-7 text-ink-950">
                        {question.prompt}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-ink-500">
                        {question.signal}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Calendar aria-hidden="true" className="h-4 w-4" />
              Candidate sessions
            </div>
            <div className="mt-3 space-y-3">
              {interview.candidateSessions.length > 0 ? (
                interview.candidateSessions.map((session) => (
                  <Link
                    key={session.id}
                    className="group grid cursor-pointer gap-3 rounded-3xl border border-ink-100 bg-white/76 p-4 shadow-soft transition hover:border-ink-300 hover:bg-white sm:grid-cols-[1fr_auto] sm:items-center"
                    href={`/interviews/${session.realtimeSessionId ?? session.id}`}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge className={statusBadgeClass(session.status)}>
                          {formatStatus(session.status)}
                        </Badge>
                        <span className="text-xs font-medium text-ink-400">
                          {session.realtimeSessionId ?? session.id}
                        </span>
                      </span>
                      <span className="mt-2 block text-sm text-ink-500">
                        Started {formatDate(session.startedAt)}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-ink-900 transition group-hover:translate-x-0.5">
                      Open
                    </span>
                  </Link>
                ))
              ) : (
                <Card className="border-dashed bg-white/58 p-5">
                  <p className="text-sm font-semibold text-ink-900">
                    No candidate session yet
                  </p>
                  <p className="mt-2 text-sm leading-6 text-ink-500">
                    Once a candidate opens the link and starts, their session
                    will appear here for review.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>

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
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
              Guardrails
            </div>
            <div className="mt-4 space-y-3">
              {interview.guardrails.map((guardrail) => (
                <p key={guardrail} className="text-sm leading-6 text-ink-600">
                  {guardrail}
                </p>
              ))}
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
    interviewId: string;
    realtimeSessionId: string | null;
    roleTitle: string;
    status: string;
  };
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-sm font-medium text-ink-600 transition hover:text-ink-950"
        href={`/interviews/${session.interviewId}`}
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Interview
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

function formatModeSummary(modes: string[]) {
  if (modes.length === 0) {
    return "Form + Audio";
  }

  return modes
    .map((mode) => (mode === "text" ? "Form" : mode[0]!.toUpperCase() + mode.slice(1)))
    .join(" + ");
}

function formatQuestionSource(source: string) {
  if (source === "job_description") {
    return "Role brief";
  }

  if (source === "attachment") {
    return "Attachment";
  }

  return "IA";
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

function getSessionStats(
  sessions: Array<{
    completedAt: string | null;
    status: string;
  }>,
) {
  const completed = sessions.filter(
    (session) => session.status === "completed" || session.completedAt,
  ).length;
  const started = sessions.filter((session) => session.status !== "created").length;

  return {
    completed,
    needsReview: completed,
    started,
  };
}

function InsightPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white/68 px-4 py-3 shadow-soft">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-white">
        {icon}
      </span>
      <span>
        <span className="block text-xs font-medium text-ink-500">{label}</span>
        <span className="block text-xl font-semibold text-ink-950">{value}</span>
      </span>
    </div>
  );
}
