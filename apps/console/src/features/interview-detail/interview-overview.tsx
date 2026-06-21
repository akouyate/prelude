import Link from "next/link";
import {
  ArrowLeft,
  EditPencil,
} from "iconoir-react";
import { StatusBadge } from "@prelude/ui";
import type { CandidateScreenListItem } from "../candidate-screens";

import type { getInterviewDetail } from "../../server/interviews/interview-loaders";
import {
  InterviewOverviewTabs,
  CopyCandidateLinkButton,
  type InterviewOverviewConfigItem,
  type InterviewOverviewCriterion,
  type InterviewOverviewQuestion,
  type InterviewOverviewSource,
  type InterviewOverviewStat,
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
  const source = getSourceMeta({
    location: interview.location,
    provider: interview.sourceProvider,
    roleTitle: interview.roleTitle,
  });
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
  const stats = [
    {
      label: "Candidates",
      value: String(interview.candidateSessions.length),
    },
    {
      label: "Need review",
      tone: sessionStats.needsReview > 0 ? "danger" : "default",
      value: String(sessionStats.needsReview),
    },
    {
      label: "Questions",
      value: String(interview.questions.length),
    },
    {
      label: "Avg length",
      value: `${estimatedMinutes}m`,
    },
  ] satisfies InterviewOverviewStat[];
  const config = [
    { label: "Format", value: formatModeSummary(interview.responseModes) },
    { label: "Length cap", value: `~${estimatedMinutes} minutes` },
    { label: "Language", value: "Auto-detect" },
    { label: "Interviewer voice", value: "Default voice" },
    { label: "Visibility", value: "Anyone with the link" },
  ] satisfies InterviewOverviewConfigItem[];
  const editHref = interview.draftId
    ? `/roles/new?draftId=${interview.draftId}`
    : `/roles/new?jobId=${interview.jobId}`;

  return (
    <main className="mx-auto max-w-[920px] pb-16">
      <Link
        className="inline-flex cursor-pointer items-center gap-[7px] rounded-full text-[13px] font-semibold text-[#777166] transition hover:text-ink-950"
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
            {source ? (
              <a
                className="inline-flex h-6 cursor-pointer items-center gap-[7px] rounded-full border border-[#e7e2d8] bg-[#f4f2ea] py-0 pl-1.5 pr-2.5 text-[11.5px] font-semibold text-[#5b574f] transition hover:border-[#cbc4b6]"
                href="#"
                target="_blank"
              >
                <span
                  className="grid h-4 w-4 place-items-center rounded text-[9px] font-bold tracking-[-0.02em]"
                  style={{
                    background: source.monoBg,
                    color: source.monoFg,
                  }}
                >
                  {source.mono}
                </span>
                {source.name}
              </a>
            ) : null}
            <span className="text-[13px] text-[#8a8178]">
              {formatModeSummary(interview.responseModes)} ·{" "}
              {interview.questions.length} questions · ~{estimatedMinutes} min
            </span>
          </div>

          <h1 className="mt-3 text-[clamp(26px,3.2vw,34px)] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-950">
            {interview.roleTitle}
          </h1>
          <p className="mt-2 text-[13.5px] leading-6 text-[#777166]">
            {detail.organizationName} · {interview.jobTitle}
            {interview.location ? ` · ${interview.location}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <CopyCandidateLinkButton candidatePath={interview.candidatePath}>
            {candidateLinkLabel}
          </CopyCandidateLinkButton>
          <Link
            className="inline-flex h-[42px] cursor-pointer items-center justify-center gap-2 rounded-full bg-[#171715] px-[18px] text-[13px] font-semibold text-white transition hover:bg-[#2a2925] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            href={editHref}
          >
            <EditPencil aria-hidden={true} className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </header>

      <InterviewOverviewTabs
        candidatePath={interview.candidatePath}
        candidates={candidates}
        config={config}
        criteria={criteria}
        guardrails={interview.guardrails}
        interviewId={interview.id}
        publicationStatus={interview.status}
        questions={questions}
        roleBrief={interview.roleBrief}
        roleTitle={interview.roleTitle}
        source={source}
        stats={stats}
        summaryLine={buildSummaryLine(sessionStats)}
      />
    </main>
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

function getSourceMeta({
  location,
  provider,
  roleTitle,
}: {
  location: string | null;
  provider: string | null;
  roleTitle: string;
}): InterviewOverviewSource | null {
  if (provider === "linkedin") {
    return {
      mono: "in",
      monoBg: "#0a66c2",
      monoFg: "#ffffff",
      name: "LinkedIn",
      sub: `“${roleTitle}${location ? ` — ${location}` : ""}”`,
      title: "Imported from LinkedIn",
    };
  }

  if (provider === "indeed") {
    return {
      mono: "Id",
      monoBg: "#2557a7",
      monoFg: "#ffffff",
      name: "Indeed",
      sub: `“${roleTitle}${location ? ` — ${location}` : ""}”`,
      title: "Imported from Indeed",
    };
  }

  return null;
}

function formatStatus(status: string) {
  if (status === "published") {
    return "Live";
  }

  if (status === "paused") {
    return "Paused";
  }

  return status.replace(/_/g, " ");
}

function formatModeSummary(modes: string[]) {
  if (modes.length === 0) {
    return "Form + Audio";
  }

  const labels = modes.map((mode) => {
    if (mode === "text") {
      return "Form";
    }

    if (mode === "audio") {
      return "Voice";
    }

    return mode[0]!.toUpperCase() + mode.slice(1);
  });

  if (labels.includes("Voice")) {
    return `Voice first · ${labels.filter((label) => label !== "Voice").join(" + ") || "adaptive follow-ups"}`;
  }

  return labels.join(" + ");
}

function formatQuestionSource(source: string) {
  if (source === "job_description") {
    return "From role brief";
  }

  if (source === "attachment") {
    return "Attachment";
  }

  return "AI generated";
}

function statusTone(status: string) {
  if (status === "published") {
    return "olive";
  }

  if (status === "paused") {
    return "muted";
  }

  if (status === "in_progress" || status === "waiting_candidate") {
    return "warning";
  }

  if (status === "completed" || status === "needs_review") {
    return "danger";
  }

  return "muted";
}
