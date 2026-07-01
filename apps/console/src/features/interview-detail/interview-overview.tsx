import Link from "next/link";
import { ArrowLeft, EditPencil } from "iconoir-react";
import type { TFunction } from "i18next";
import { StatusBadge } from "@prelude/ui";
import type { CandidateScreenListItem } from "../candidate-screens";

import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../../server/users/user-locale";
import type { getInterviewDetail } from "../../server/interviews/interview-loaders";
import { CopyCandidateLinkButton } from "./copy-candidate-link-button";
import {
  InterviewOverviewTabs,
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

export async function InterviewOverview({
  detail,
}: {
  detail: InterviewOverviewDetail;
}) {
  const locale = await getAuthenticatedUserLocale();
  const t = getServerT(locale);
  const { interview } = detail;
  const sessionStats = getSessionStats(interview.candidateSessions);
  const estimatedMinutes = getEstimatedMinutes(interview);
  const source = getSourceMeta(
    {
      location: interview.location,
      provider: interview.sourceProvider,
      roleTitle: interview.roleTitle,
    },
    t,
  );
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
  const invitations = interview.candidateInvitations;
  const questions = interview.questions.map((question, index) => ({
    id: question.id,
    numberLabel: String(index + 1).padStart(2, "0"),
    prompt: question.prompt,
    signal: question.expectedSignal,
    sourceLabel: formatQuestionSource(question.source, t),
  })) satisfies InterviewOverviewQuestion[];
  const criteria = interview.criteria.map((criterion) => ({
    description: criterion.description,
    id: criterion.id,
    label: criterion.label,
  })) satisfies InterviewOverviewCriterion[];
  const stats = [
    {
      label: t("interviewDetail.statCandidates"),
      value: String(interview.candidateSessions.length),
    },
    {
      label: t("interviewDetail.statNeedReview"),
      tone: sessionStats.needsReview > 0 ? "danger" : "default",
      value: String(sessionStats.needsReview),
    },
    {
      label: t("interviewDetail.statQuestions"),
      value: String(interview.questions.length),
    },
    {
      label: t("interviewDetail.statAvgLength"),
      value: t("interviewDetail.statAvgLengthValue", {
        minutes: estimatedMinutes,
      }),
    },
  ] satisfies InterviewOverviewStat[];
  const config = [
    {
      label: t("interviewDetail.configFormat"),
      value: formatModeSummary(interview.responseModes, t),
    },
    {
      label: t("interviewDetail.configLengthCap"),
      value: t("interviewDetail.configLengthCapValue", {
        minutes: estimatedMinutes,
      }),
    },
    {
      label: t("interviewDetail.configLanguage"),
      value: t("interviewDetail.configLanguageValue"),
    },
    {
      label: t("interviewDetail.configInterviewerVoice"),
      value: t("interviewDetail.configInterviewerVoiceValue"),
    },
    {
      label: t("interviewDetail.configVisibility"),
      value: t("interviewDetail.configVisibilityValue"),
    },
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
        {t("interviewDetail.backToRoles")}
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(interview.status)}>
              {formatStatus(interview.status, t)}
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
              {t("interviewDetail.headerMeta", {
                count: interview.questions.length,
                minutes: estimatedMinutes,
                mode: formatModeSummary(interview.responseModes, t),
              })}
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
            {t("interviewDetail.editButton")}
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
        invitations={invitations}
        publicationStatus={interview.status}
        questions={questions}
        roleBrief={interview.roleBrief}
        roleTitle={interview.roleTitle}
        source={source}
        stats={stats}
        summaryLine={buildSummaryLine(sessionStats, t)}
      />
    </main>
  );
}

function buildSummaryLine(
  {
    completed,
    needsReview,
    started,
  }: {
    completed: number;
    needsReview: number;
    started: number;
  },
  t: TFunction,
) {
  if (started === 0) {
    return t("interviewDetail.summaryNoneStarted");
  }

  return t("interviewDetail.summaryLine", { completed, needsReview, started });
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

function getSourceMeta(
  {
    location,
    provider,
    roleTitle,
  }: {
    location: string | null;
    provider: string | null;
    roleTitle: string;
  },
  t: TFunction,
): InterviewOverviewSource | null {
  if (provider === "linkedin") {
    return {
      mono: "in",
      monoBg: "#0a66c2",
      monoFg: "#ffffff",
      name: t("interviewDetail.sourceLinkedinName"),
      sub: `“${roleTitle}${location ? ` — ${location}` : ""}”`,
      title: t("interviewDetail.sourceLinkedinTitle"),
    };
  }

  if (provider === "indeed") {
    return {
      mono: "Id",
      monoBg: "#2557a7",
      monoFg: "#ffffff",
      name: t("interviewDetail.sourceIndeedName"),
      sub: `“${roleTitle}${location ? ` — ${location}` : ""}”`,
      title: t("interviewDetail.sourceIndeedTitle"),
    };
  }

  return null;
}

function formatStatus(status: string, t: TFunction) {
  if (status === "published") {
    return t("interviewDetail.statusLive");
  }

  if (status === "paused") {
    return t("interviewDetail.statusPaused");
  }

  return status.replace(/_/g, " ");
}

function formatModeSummary(modes: string[], t: TFunction) {
  if (modes.length === 0) {
    return t("interviewDetail.modeFormAudio");
  }

  const voiceLabel = t("interviewDetail.modeVoice");
  const labels = modes.map((mode) => {
    if (mode === "text") {
      return t("interviewDetail.modeForm");
    }

    if (mode === "audio") {
      return voiceLabel;
    }

    return mode[0]!.toUpperCase() + mode.slice(1);
  });

  if (labels.includes(voiceLabel)) {
    const rest =
      labels.filter((label) => label !== voiceLabel).join(" + ") ||
      t("interviewDetail.modeAdaptiveFollowups");

    return t("interviewDetail.modeVoiceFirst", { rest });
  }

  return labels.join(" + ");
}

function formatQuestionSource(source: string, t: TFunction) {
  if (source === "job_description") {
    return t("interviewDetail.questionSourceRoleBrief");
  }

  if (source === "attachment") {
    return t("interviewDetail.questionSourceAttachment");
  }

  return t("interviewDetail.questionSourceAi");
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
