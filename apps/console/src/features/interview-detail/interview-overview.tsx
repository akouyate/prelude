import Link from "next/link";
import {
  ArrowLeft,
  EditPencil,
  Link as LinkIcon,
} from "iconoir-react";
import { StatusBadge } from "@prelude/ui";
import type { CandidateScreenListItem } from "../candidate-screens";

import type { getInterviewDetail } from "../../server/interviews/interview-loaders";
import {
  InterviewOverviewTabs,
  type InterviewOverviewCriterion,
  type InterviewOverviewQuestion,
} from "./interview-overview-tabs";

type InterviewOverviewDetail = NonNullable<
  Awaited<ReturnType<typeof getInterviewDetail>>
> & {
  kind: "interview";
};

export function InterviewOverview({
  detail,
}: {
  detail: InterviewOverviewDetail;
}) {
  const { interview } = detail;
  const sessionStats = getSessionStats(interview.candidateSessions);
  const estimatedMinutes = getEstimatedMinutes(interview);
  const candidateLinkLabel = `prelude.ai${interview.candidatePath}`;
  const candidates = interview.candidateSessions.map((session) => ({
    analysisStatus: session.analysisStatus,
    candidateLabel: session.candidateLabel,
    completedAt: session.completedAt,
    criteriaDistribution: session.criteriaDistribution,
    hasCompletedBrief: session.hasCompletedBrief,
    href: `/interviews/${session.realtimeSessionId ?? session.id}`,
    id: session.id,
    jobTitle: interview.jobTitle,
    pointsToClarifyCount: session.pointsToClarifyCount,
    questionCompletionRate: session.questionCompletionRate,
    reviewStatus: session.reviewStatus,
    roleTitle: interview.roleTitle,
    startedAt: session.startedAt,
    status: session.status,
  })) satisfies CandidateScreenListItem[];
  const questions = interview.questions.map((question, index) => ({
    id: question.id,
    numberLabel: String(index + 1).padStart(2, "0"),
    prompt: question.prompt,
    signal: question.signal,
    sourceLabel: formatQuestionSource(question.source),
  })) satisfies InterviewOverviewQuestion[];
  const criteria = interview.criteria.map((criterion) => ({
    description: criterion.description,
    id: criterion.id,
    label: criterion.label,
  })) satisfies InterviewOverviewCriterion[];

  return (
    <main className="mx-auto max-w-[920px] pb-16">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-[13px] font-semibold text-ink-500 transition hover:text-ink-950"
        href="/roles"
      >
        <ArrowLeft aria-hidden={true} className="h-4 w-4" />
        Roles
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(interview.status)}>
              {formatStatus(interview.status)}
            </StatusBadge>
            <a
              className="inline-flex h-6 max-w-[260px] cursor-pointer items-center gap-2 rounded-full border border-ink-100 bg-[#f4f2ea] py-0 pl-1.5 pr-2.5 text-[11.5px] font-semibold text-ink-600 transition hover:border-ink-300"
              href={interview.candidatePath}
              target="_blank"
            >
              <LinkIcon aria-hidden={true} className="h-3.5 w-3.5" />
              <span className="truncate">{candidateLinkLabel}</span>
            </a>
            <span className="text-[13px] text-ink-400">
              {formatModeSummary(interview.responseModes)} ·{" "}
              {interview.questions.length} questions · ~{estimatedMinutes} min
            </span>
          </div>

          <h1 className="mt-3 text-[clamp(28px,3.2vw,36px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
            {interview.roleTitle}
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            {detail.organizationName} · {interview.jobTitle}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <a
            className="inline-flex h-[42px] max-w-[280px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-900 transition hover:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            href={interview.candidatePath}
            target="_blank"
          >
            <LinkIcon aria-hidden={true} className="h-4 w-4 text-ink-400" />
            <span className="truncate">Candidate link</span>
          </a>
          {interview.draftId ? (
            <Link
              className="inline-flex h-[42px] cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-[18px] text-[13px] font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
              href={`/interviews/new?draftId=${interview.draftId}`}
            >
              <EditPencil aria-hidden={true} className="h-4 w-4" />
              Edit
            </Link>
          ) : null}
        </div>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <CompactMetric label="Started" value={String(sessionStats.started)} />
        <CompactMetric
          label="Completed"
          value={String(sessionStats.completed)}
        />
        <CompactMetric
          label="Needs review"
          value={String(sessionStats.needsReview)}
        />
      </section>

      <InterviewOverviewTabs
        candidates={candidates}
        criteria={criteria}
        guardrails={interview.guardrails}
        questions={questions}
        roleBrief={interview.roleBrief}
        summaryLine={buildSummaryLine(sessionStats)}
      />
    </main>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/72 px-4 py-3">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-ink-950">
        {value}
      </p>
    </div>
  );
}

function buildSummaryLine({
  completed,
  needsReview,
  started,
}: {
  completed: number;
  needsReview: number;
  started: number;
}) {
  if (started === 0) {
    return "No candidate has started this role screen yet.";
  }

  return `${needsReview} need review · ${started} started · ${completed} completed`;
}

function getSessionStats(
  sessions: InterviewOverviewDetail["interview"]["candidateSessions"],
) {
  const completedSessions = sessions.filter(
    (session) => session.status === "completed" || session.completedAt,
  );
  const started = sessions.filter(
    (session) => session.status !== "created",
  ).length;

  return {
    completed: completedSessions.length,
    needsReview: completedSessions.filter(
      (session) => session.reviewStatus === "to_review",
    ).length,
    started,
  };
}

function getEstimatedMinutes(interview: {
  estimatedMinutes: number | null;
  questions: Array<{ durationSeconds: number }>;
}) {
  if (interview.estimatedMinutes) {
    return interview.estimatedMinutes;
  }

  const totalSeconds = interview.questions.reduce(
    (total, question) => total + question.durationSeconds,
    0,
  );

  return Math.max(1, Math.round(totalSeconds / 60));
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatModeSummary(modes: string[]) {
  if (modes.length === 0) {
    return "Form + Audio";
  }

  return modes
    .map((mode) =>
      mode === "text" ? "Form" : mode[0]!.toUpperCase() + mode.slice(1),
    )
    .join(" + ");
}

function formatQuestionSource(source: string) {
  if (source === "job_description") {
    return "Role brief";
  }

  if (source === "attachment") {
    return "Attachment";
  }

  return "AI generated";
}

function statusTone(status: string) {
  if (status === "published") {
    return "dark";
  }

  if (status === "in_progress" || status === "waiting_candidate") {
    return "warning";
  }

  if (status === "completed" || status === "needs_review") {
    return "danger";
  }

  return "olive";
}
