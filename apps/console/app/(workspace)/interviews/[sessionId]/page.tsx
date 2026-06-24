import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { type CandidateBriefDto } from "@prelude/contracts";
import { recruiterLimitationCopy } from "@prelude/core";
import { Button, Card, StatusBadge, Textarea } from "@prelude/ui";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Clock,
  NavArrowDown,
  NavArrowLeft,
  NavArrowRight,
  PlaySolid,
  ShareIos,
  ShieldCheck,
  Sparks,
  WarningTriangle,
  Xmark,
} from "iconoir-react";

import { getConsoleAuthContext } from "../../../../src/server/auth/console-auth";
import { generateCandidateBriefAction } from "../../../../src/server/interviews/candidate-brief-actions";
import { AutoGenerateBrief } from "../../../../src/features/interview-detail/auto-generate-brief";
import { shouldAutoGenerateBrief } from "../../../../src/features/interview-detail/brief-auto-generation";
import { updateCandidateReviewAction } from "../../../../src/server/interviews/candidate-review-actions";
import { getInterviewDetail } from "../../../../src/server/interviews/interview-loaders";
import type { CandidateSessionEvidence } from "../../../../src/server/interviews/live-session-evidence";
import {
  canManageCandidateReview,
  candidateReviewNoteMaxLength,
} from "../../../../src/domain/candidate-review-policy";
import {
  candidateReviewStatusTone,
  formatCandidateReviewStatus,
  initialsForCandidate,
} from "../../../../src/features/candidate-screens";
import { CandidateDetailTabs } from "../../../../src/features/interview-detail/candidate-detail-tabs";
import { CandidateVoicePlayer } from "../../../../src/features/interview-detail/candidate-voice-player";
import { DeleteRecordingButton } from "../../../../src/features/interview-detail/delete-recording-button";
import { canDeleteRecording } from "../../../../src/domain/recording-policy";

type InterviewDetailPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InterviewDetailPage({
  params,
}: InterviewDetailPageProps) {
  const { sessionId } = await params;
  const [account, detail] = await Promise.all([
    getConsoleAuthContext(),
    getInterviewDetail(sessionId),
  ]);

  if (!detail) {
    notFound();
  }

  if (detail.kind === "interview") {
    redirect(`/roles/${detail.interview.id}`);
  }

  return (
    <CandidateSessionReview
      canDelete={canDeleteRecording(account.role)}
      canManageReview={canManageCandidateReview(account.role)}
      session={detail.candidateSession}
    />
  );
}

function CandidateSessionReview({
  canDelete,
  canManageReview,
  session,
}: {
  canDelete: boolean;
  canManageReview: boolean;
  session: {
    analysisStatus: "available" | "pending" | "not_ready" | "failed";
    brief: CandidateBriefDto | null;
    candidateLabel: string;
    completedAt: string | null;
    criteriaDistribution: {
      "Not assessable": number;
      Medium: number;
      Strong: number;
      Weak: number;
    };
    eventCount: number;
    evidence: CandidateSessionEvidence;
    hasCompletedBrief: boolean;
    id: string;
    interviewId: string;
    jobTitle: string;
    limitationsCount: number;
    pointsToClarifyCount: number | null;
    questions: Array<{
      id: string;
      prompt: string;
      expectedSignal: string;
    }>;
    questionCompletionRate: number | null;
    realtimeSessionId: string | null;
    reviewNote: string | null;
    reviewNotePreview: string | null;
    reviewNoteUpdatedAt: string | null;
    reviewNoteUpdatedBy: string | null;
    reviewStatus: "to_call" | "to_review" | "archived";
    reviewStatusUpdatedAt: string | null;
    reviewStatusUpdatedBy: string | null;
    roleTitle: string;
    startedAt: string | null;
    status: string;
    transcriptTurnCount: number;
  };
}) {
  const displayedAnalysisStatus = session.brief
    ? briefAnalysisStatus(session.brief)
    : session.analysisStatus;
  const detailPath = `/interviews/${session.realtimeSessionId ?? session.id}`;
  const signalSummary = getSignalSummary(session.criteriaDistribution);

  return (
    <main className="mx-auto max-w-[1140px] pb-20">
      <div className="flex items-center justify-between gap-4">
        <Link
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-full text-[13px] font-semibold text-ink-500 transition hover:text-ink-950"
          href="/candidates"
        >
          <ArrowLeft aria-hidden={true} className="h-4 w-4" />
          {session.roleTitle}
          <span className="font-medium text-[#cbc4b6]">/ Candidates</span>
        </Link>
        <div className="hidden items-center gap-[9px] sm:flex">
          <span className="text-[12.5px] font-medium text-[#a29b8d]">
            1 of 1
          </span>
          <button
            aria-label="Previous candidate"
            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[9px] border border-[#e2ddd2] bg-white text-ink-600 transition hover:border-ink-950 hover:text-ink-950"
            type="button"
          >
            <NavArrowLeft aria-hidden={true} className="h-4 w-4" />
          </button>
          <button
            aria-label="Next candidate"
            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[9px] border border-[#e2ddd2] bg-white text-ink-600 transition hover:border-ink-950 hover:text-ink-950"
            type="button"
          >
            <NavArrowRight aria-hidden={true} className="h-4 w-4" />
          </button>
        </div>
      </div>

      <header className="mt-[18px] flex flex-wrap items-start justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-[#eef0e3] text-xl font-semibold text-olive-900">
            {initialsForCandidate(session.candidateLabel)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-[9px]">
              <h1 className="text-[clamp(23px,2.6vw,29px)] font-semibold leading-[1.15] tracking-[-0.025em] text-ink-950">
                {session.candidateLabel}
              </h1>
              <StatusBadge tone={candidateReviewStatusTone(session.reviewStatus)}>
                {formatCandidateReviewStatus(session.reviewStatus)}
              </StatusBadge>
            </div>
            <p className="mt-[7px] text-[13.5px] leading-6 text-[#777166]">
              <span className="font-semibold text-[#5b574f]">
                {session.roleTitle}
              </span>{" "}
              · {session.jobTitle} · applied via Prelude
            </p>
          </div>
        </div>
        <button
          className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#ddd8cc] bg-white px-[14px] text-[13px] font-semibold text-ink-950 transition hover:border-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          type="button"
        >
          <ShareIos aria-hidden={true} className="h-4 w-4" />
          Share
        </button>
      </header>

      <CandidateDetailTabs
        answers={
          <QuestionAnswerCard
            evidence={session.evidence}
            questions={session.questions}
          />
        }
        evidence={
          <div className="space-y-6">
            {session.brief ? (
              <AuditGuardrailsPanel
                eventCount={session.eventCount}
                realtimeSessionId={session.realtimeSessionId}
                transcriptTurnCount={session.transcriptTurnCount}
              />
            ) : (
              <AnalysisStateCard
                displayedAnalysisStatus={displayedAnalysisStatus}
                eventCount={session.eventCount}
                realtimeSessionId={session.realtimeSessionId}
              />
            )}
            {session.evidence.status === "completed" &&
            session.brief?.status !== "completed" ? (
              shouldAutoGenerateBrief(
                session.evidence.status,
                session.brief?.status,
              ) ? (
                // #5: evidence is ready and no usable brief yet — generate
                // automatically instead of waiting for a manual click.
                <AutoGenerateBrief
                  detailPath={detailPath}
                  sessionId={session.id}
                />
              ) : (
                // Processing or failed — keep the manual (retry) affordance.
                <GenerateBriefCard
                  detailPath={detailPath}
                  hasFailed={session.brief?.status === "failed"}
                  sessionId={session.id}
                />
              )
            ) : null}
            <DataLimitationsCard
              brief={session.brief}
              evidence={session.evidence}
              limitationsCount={session.limitationsCount}
              questionCompletionRate={session.questionCompletionRate}
            />
          </div>
        }
        nextCall={<NextCallPrepSection session={session} />}
        rail={
          <CandidateReviewRail
            canManageReview={canManageReview}
            detailPath={detailPath}
            displayedAnalysisStatus={displayedAnalysisStatus}
            session={session}
            sessionId={session.id}
            signalSummary={signalSummary}
          />
        }
        recording={
          <CandidateRecordingView canDelete={canDelete} session={session} />
        }
      />
    </main>
  );
}

type CandidateSessionReviewSession = Parameters<
  typeof CandidateSessionReview
>[0]["session"];
type CandidateReviewStatus = CandidateSessionReviewSession["reviewStatus"];

function CandidateRecordingView({
  canDelete,
  session,
}: {
  canDelete: boolean;
  session: CandidateSessionReviewSession;
}) {
  const moments = getKeyMoments(session);
  const criteria = getCriterionEvidenceCards(session);

  return (
    <div className="min-w-0 space-y-7">
        <section className="rounded-[18px] border border-[#e7e2d8] bg-white/75 px-[19px] py-[17px] backdrop-blur">
          <div className="flex items-start gap-[13px]">
            <span
              className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-white"
              style={{ backgroundColor: "#171612" }}
            >
              <Sparks aria-hidden={true} className="h-[17px] w-[17px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#a29b8d]">
                Prelude summary
              </p>
              <p className="mt-[5px] max-w-[60ch] text-[14.5px] leading-[1.6] text-[#3c392f]">
                {session.brief?.summary ??
                  "The candidate interview is recorded. Generate the recruiter brief once the completed transcript has enough persisted evidence."}
              </p>
            </div>
          </div>
        </section>

        <CandidateVoicePlayer
          fallbackDurationMs={getRecordingDurationMs(
            session.evidence.transcriptTurns,
          )}
          recording={session.evidence.recording}
        />
        <DeleteRecordingButton
          candidateSessionId={session.id}
          canDelete={canDelete}
          recordingStatus={session.evidence.recording?.status ?? null}
        />

        <section className="overflow-hidden rounded-[20px] border border-[#e7e2d8] bg-white">
          <div className="flex items-center justify-between gap-3">
            <p className="px-[22px] pt-[18px] text-[11px] font-bold uppercase tracking-[0.12em] text-[#a29b8d]">
              Key moments
            </p>
            <button
              className="mr-[22px] mt-[18px] inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-semibold text-[#5b574f] transition hover:text-ink-950"
              type="button"
            >
              Full transcript
              <ArrowRight aria-hidden={true} className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-2 px-[22px] pb-5 pt-3">
            {moments.map((moment) => (
              <button
                className="flex w-full cursor-pointer items-start gap-[13px] rounded-[13px] border border-[#ece8de] bg-white px-[14px] py-3 text-left transition hover:border-[#cbc4b6]"
                key={`${moment.time}-${moment.quote}`}
                type="button"
              >
                <span className="mt-px inline-flex h-[21px] shrink-0 items-center rounded-md border border-[#e7e2d8] bg-white px-2 font-mono text-[11px] font-medium text-[#5b574f]">
                  {moment.time}
                </span>
                <div className="min-w-0">
                  <p className="mb-[3px] flex items-center gap-2 text-[11px] font-semibold text-ink-700">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: moment.dot }}
                    />
                    {moment.label}
                  </p>
                  <p className="text-[13.5px] leading-[1.5] text-[#3c392f]">
                    {moment.quote}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink-950">
            Evidence by criterion
          </h2>
          <p className="mt-[3px] text-[13.5px] leading-6 text-[#777166]">
            How each requirement held up from the conversation, with
            representative evidence when available.
          </p>
          <div className="mt-4 flex flex-col gap-2.5">
            {criteria.map((criterion) => (
              <article
                className="rounded-2xl border border-[#e7e2d8] bg-white px-[18px] py-4"
                key={criterion.id}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-[9px] w-[9px] shrink-0 rounded-full"
                    style={{ background: criterion.dot }}
                  />
                  <p className="min-w-0 flex-1 text-[14.5px] font-semibold text-ink-950">
                    {criterion.label}
                  </p>
                  <StatusBadge tone={briefCriterionTone(criterion.status)}>
                    {criterion.status}
                  </StatusBadge>
                </div>
                <p className="mt-2.5 text-[13.5px] leading-[1.55] text-[#5b574f]">
                  {criterion.note}
                </p>
                {criterion.quote ? (
                  <blockquote
                    className="mt-3 border-l-2 py-0.5 pl-[13px] text-[13px] italic leading-[1.55] text-[#6f6a5f]"
                    style={{ borderColor: criterion.dot }}
                  >
                    {criterion.quote}
                  </blockquote>
                ) : null}
              </article>
            ))}
          </div>
        </section>
    </div>
  );
}

function CandidateReviewRail({
  canManageReview,
  detailPath,
  displayedAnalysisStatus,
  session,
  sessionId,
  signalSummary,
}: {
  canManageReview: boolean;
  detailPath: string;
  displayedAnalysisStatus: string;
  session: CandidateSessionReviewSession;
  sessionId: string;
  signalSummary: SignalSummary;
}) {
  return (
    <>
      <CandidateSignalCard
        displayedAnalysisStatus={displayedAnalysisStatus}
        hasCompletedBrief={session.hasCompletedBrief}
        signalSummary={signalSummary}
      />
      <CandidateDecisionPanel
        canManageReview={canManageReview}
        detailPath={detailPath}
        reviewNote={session.reviewNote}
        reviewStatus={session.reviewStatus}
        sessionId={sessionId}
      />
      <CandidateInternalNotePanel
        canManageReview={canManageReview}
        detailPath={detailPath}
        reviewNote={session.reviewNote}
        reviewStatus={session.reviewStatus}
        sessionId={sessionId}
      />
      <CandidateMetadataCard session={session} />
      <Card className="rounded-[18px] border-[#e7e2d8] bg-white/75 p-[18px]">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ShieldCheck aria-hidden={true} className="h-4 w-4" />
          Human review only
        </div>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          {recruiterLimitationCopy}
        </p>
      </Card>
    </>
  );
}

type SignalSummary = {
  missing: number;
  partial: number;
  strong: number;
  total: number;
  weak: number;
};

function CandidateSignalCard({
  displayedAnalysisStatus,
  hasCompletedBrief,
  signalSummary,
}: {
  displayedAnalysisStatus: string;
  hasCompletedBrief: boolean;
  signalSummary: SignalSummary;
}) {
  return (
    <section className="rounded-[18px] border border-[#e7e2d8] bg-white/80 p-[18px] backdrop-blur">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#a29b8d]">
        Signal
      </p>
      <p className="mt-2 text-[21px] font-semibold tracking-[-0.02em] text-ink-950">
        {hasCompletedBrief
          ? `${signalSummary.strong} of ${signalSummary.total} strong`
          : formatAnalysisStatus(displayedAnalysisStatus)}
      </p>
      <SignalSegments signalSummary={signalSummary} />
      <p className="mt-2.5 text-[12.5px] text-[#777166]">
        {hasCompletedBrief
          ? `${signalSummary.strong} strong · ${signalSummary.partial} partial · ${signalSummary.missing} missing`
          : "Waiting for persisted AI synthesis."}
      </p>
    </section>
  );
}

function SignalSegments({ signalSummary }: { signalSummary: SignalSummary }) {
  const total = Math.max(signalSummary.total, 1);
  const segments = [
    { color: "#5c7606", count: signalSummary.strong, label: "Strong" },
    { color: "#e1b855", count: signalSummary.partial, label: "Partial" },
    { color: "#d99a7b", count: signalSummary.weak, label: "Weak" },
    { color: "#ddd8cc", count: signalSummary.missing, label: "Missing" },
  ];

  return (
    <div
      aria-label="Candidate criteria signal"
      className="mt-3 flex h-[7px] gap-[5px]"
      role="img"
    >
      {segments.map((segment) =>
        segment.count > 0 ? (
          <span
            className="rounded-full"
            key={segment.label}
            style={{
              background: segment.color,
              flexGrow: segment.count,
              minWidth: `${Math.max((segment.count / total) * 100, 12)}%`,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

const candidateDecisionOptions: Array<{
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  activeClassName: string;
  label: string;
  value: CandidateReviewStatus;
}> = [
  {
    Icon: ArrowRight,
    activeClassName:
      "peer-checked:border-[oklch(0.62_0.12_121)] peer-checked:bg-[#effaf4] peer-checked:text-[#1a5037]",
    label: "Advance",
    value: "to_call",
  },
  {
    Icon: Clock,
    activeClassName:
      "peer-checked:border-[#d9a23c] peer-checked:bg-[#fbf0d8] peer-checked:text-[#6b4710]",
    label: "Hold",
    value: "to_review",
  },
  {
    Icon: Xmark,
    activeClassName:
      "peer-checked:border-[#c4683f] peer-checked:bg-[#fbeae4] peer-checked:text-[#8a3a26]",
    label: "Pass",
    value: "archived",
  },
];

function CandidateDecisionPanel({
  canManageReview,
  detailPath,
  reviewNote,
  reviewStatus,
  sessionId,
}: {
  canManageReview: boolean;
  detailPath: string;
  reviewNote: string | null;
  reviewStatus: CandidateReviewStatus;
  sessionId: string;
}) {
  return (
    <section className="rounded-[18px] border border-[#e7e2d8] bg-white p-[18px]">
      <h2 className="mb-3 text-sm font-semibold text-ink-950">
        Your decision
      </h2>
      <form action={updateCandidateReviewAction}>
        <input name="candidateSessionId" type="hidden" value={sessionId} />
        <input name="detailPath" type="hidden" value={detailPath} />
        <input name="reviewNote" type="hidden" value={reviewNote ?? ""} />
        <fieldset
          className="grid grid-cols-3 gap-2 disabled:opacity-60"
          disabled={!canManageReview}
        >
          <legend className="sr-only">Candidate review decision</legend>
          {candidateDecisionOptions.map((option) => (
            <label className="cursor-pointer" key={option.value}>
              <input
                className="peer sr-only"
                defaultChecked={reviewStatus === option.value}
                name="reviewStatus"
                type="radio"
                value={option.value}
              />
              <span
                className={`flex min-h-[64px] flex-col items-center justify-center gap-[5px] rounded-[13px] border border-[#e7e2d8] bg-white px-1 py-[11px] text-center text-[12.5px] font-semibold text-[#5b574f] transition peer-focus-visible:ring-2 peer-focus-visible:ring-olive-300 ${option.activeClassName}`}
              >
                <span className="leading-none">
                  <option.Icon aria-hidden={true} className="h-4 w-4" />
                </span>
                <span>{option.label}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <Button
          className="mt-3 h-11 w-full justify-center rounded-xl"
          disabled={!canManageReview}
          type="submit"
        >
          <Calendar aria-hidden={true} className="h-4 w-4" />
          Schedule call
        </Button>
      </form>
    </section>
  );
}

function CandidateInternalNotePanel({
  canManageReview,
  detailPath,
  reviewNote,
  reviewStatus,
  sessionId,
}: {
  canManageReview: boolean;
  detailPath: string;
  reviewNote: string | null;
  reviewStatus: CandidateReviewStatus;
  sessionId: string;
}) {
  return (
    <section className="rounded-[18px] border border-[#e7e2d8] bg-white p-[18px]">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-950">Internal note</h2>
        <span className="text-[11px] tabular-nums text-[#bdb6a8]">
          {(reviewNote ?? "").length} / {candidateReviewNoteMaxLength}
        </span>
      </div>
      <form action={updateCandidateReviewAction}>
        <input name="candidateSessionId" type="hidden" value={sessionId} />
        <input name="detailPath" type="hidden" value={detailPath} />
        <input name="reviewStatus" type="hidden" value={reviewStatus} />
        <Textarea
          className="min-h-[88px] rounded-xl border-[#e2ddd2] bg-[#faf9f5] text-[13px] leading-[1.55] focus:border-ink-950 focus:bg-white"
          defaultValue={reviewNote ?? ""}
          maxLength={candidateReviewNoteMaxLength}
          name="reviewNote"
          placeholder="Private to your team — never shared with the candidate."
        />
        <button
          className="mt-2.5 flex h-[38px] w-full cursor-pointer items-center justify-center rounded-[11px] border border-[#ddd8cc] bg-white text-[12.5px] font-semibold text-ink-950 transition hover:border-ink-950 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canManageReview}
          type="submit"
        >
          Save note
        </button>
      </form>
    </section>
  );
}

function CandidateMetadataCard({
  session,
}: {
  session: CandidateSessionReviewSession;
}) {
  return (
    <section className="rounded-[18px] border border-[#e7e2d8] bg-white px-[18px] py-1.5">
      <MetadataRow label="Role" value={session.roleTitle} />
      <MetadataRow label="Applied" value="Prelude" />
      <MetadataRow
        label="Interviewed"
        value={formatDateCompact(session.completedAt ?? session.startedAt)}
      />
      <MetadataRow
        label="Length"
        value={formatDurationLabel(
          getRecordingDurationMs(session.evidence.transcriptTurns),
        )}
      />
    </section>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#f0ece1] py-3 last:border-b-0">
      <span className="text-[12.5px] font-medium text-[#8a8178]">{label}</span>
      <span className="text-right text-[12.5px] font-semibold text-ink-950">
        {value}
      </span>
    </div>
  );
}

function QuestionAnswerCard({
  evidence,
  questions,
}: {
  evidence: CandidateSessionEvidence;
  questions: Array<{
    id: string;
    prompt: string;
    expectedSignal: string;
  }>;
}) {
  const unplannedGroups = evidence.questionAnswerSequence.filter(
    (group) =>
      !group.questionId ||
      !questions.some((question) => question.id === group.questionId),
  );

  return (
    <section id="answers">
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink-950">
        Answers
      </h2>
      <p className="mt-[3px] text-[13.5px] leading-6 text-[#777166]">
        Each question, the candidate&apos;s response, and what it signalled.
      </p>

      <div className="mt-4 overflow-hidden rounded-2xl border border-[#e7e2d8] bg-white">
        {questions.map((question, index) => {
          const group = evidence.questionAnswerSequence.find(
            (item) => item.questionId === question.id,
          );
          const candidateTurns = group?.candidateTurns ?? [];
          const answered = candidateTurns.length > 0;
          const firstCandidateTurn = candidateTurns[0] ?? null;

          return (
            <details
              className="group border-b border-[#f0ece1] last:border-b-0"
              open={index === 0}
              key={question.id}
            >
              <summary className="flex cursor-pointer list-none items-start gap-[14px] px-[18px] py-4 transition hover:bg-[#faf9f5] [&::-webkit-details-marker]:hidden">
                <span className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-[11.5px] font-bold text-olive-800">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex h-5 items-center rounded-full px-[9px] text-[10.5px] font-semibold ${
                        answered
                          ? "bg-[#effaf4] text-[#1a5037]"
                          : "bg-[#fbeae4] text-[#8a3a26]"
                      }`}
                    >
                      {answered ? "Answered" : "No answer"}
                    </span>
                    <span className="text-[11.5px] font-medium text-[#a29b8d]">
                      {question.expectedSignal}
                    </span>
                  </div>
                  <span className="mt-1.5 block text-[14.5px] font-semibold leading-[1.45] text-ink-950">
                    {question.prompt}
                  </span>
                </span>
                <span className="mt-1 text-[#bdb6a8] transition group-open:rotate-180">
                  <NavArrowDown aria-hidden={true} className="h-[18px] w-[18px]" />
                </span>
              </summary>
              <div className="px-[18px] pb-[18px] pl-[60px]">
                <p className="text-[13.5px] leading-[1.6] text-[#5b574f]">
                  {answered
                    ? `Captured ${candidateTurns.length} candidate turn${
                        candidateTurns.length > 1 ? "s" : ""
                      } for this question.`
                    : "No answer was captured for this planned question."}
                </p>
                {firstCandidateTurn ? (
                  <blockquote className="mt-3 rounded-[11px] border-l-2 border-[#e1b855] bg-[#f7f6f1] px-[14px] py-[9px] text-[13px] italic leading-[1.55] text-[#6f6a5f]">
                    {firstCandidateTurn.text}
                  </blockquote>
                ) : null}
                <button
                  className="mt-[11px] inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border border-[#e2ddd2] bg-white px-[11px] text-xs font-semibold text-[#5b574f] transition hover:border-[#171715] hover:text-[#171715]"
                  type="button"
                >
                  <PlaySolid aria-hidden={true} className="h-[13px] w-[13px]" />
                  Listen at{" "}
                  {formatTurnTime(
                    firstCandidateTurn?.startedAt ?? null,
                    evidence.transcriptTurns[0]?.startedAt ?? null,
                  )}
                </button>
              </div>
            </details>
          );
        })}

        {questions.length === 0 ? (
          <p className="p-4 text-sm leading-6 text-[#777166]">
            No planned interview questions are attached to this session.
          </p>
        ) : null}
      </div>

      {unplannedGroups.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-[#e7e2d8] bg-[#f7f6f1] p-4">
          <p className="text-sm font-semibold text-ink-950">
            Additional transcript turns
          </p>
          <p className="mt-1 text-sm leading-6 text-[#777166]">
            These persisted turns were not linked to a planned question.
          </p>
          <div className="mt-3 space-y-2">
            {unplannedGroups.map((group, index) => (
              <p
                className="rounded-[11px] border border-[#ece8de] bg-white px-3 py-2 text-[13px] leading-[1.55] text-[#5b574f]"
                key={`${group.questionId ?? "unlinked"}-${index}`}
              >
                {[...group.interviewerTurns, ...group.candidateTurns]
                  .map((turn) => turn.text)
                  .join(" ")}
              </p>
            ))}
          </div>
        </div>
      ) : null}

    </section>
  );
}

function TranscriptTurnList({
  empty,
  title,
  turns,
}: {
  empty: string;
  title: string;
  turns: CandidateSessionEvidence["transcriptTurns"];
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">
        {title}
      </p>
      {turns.length > 0 ? (
        <div className="mt-2 space-y-2">
          {turns.map((turn) => (
            <blockquote
              key={`${turn.sequenceNumber}-${turn.turnId}`}
              className="rounded-2xl border border-ink-100 bg-white/68 p-3 text-sm leading-6 text-ink-700"
            >
              {turn.text}
            </blockquote>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-2xl border border-dashed border-ink-100 bg-white/54 p-3 text-sm leading-6 text-ink-500">
          {empty}
        </p>
      )}
    </div>
  );
}

function NextCallPrepSection({
  session,
}: {
  session: CandidateSessionReviewSession;
}) {
  const prep = getNextCallPrep(session);

  if (
    prep.clarifyFirst.length === 0 &&
    prep.worthProbing.length === 0 &&
    prep.alreadyCovered.length === 0
  ) {
    return null;
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink-950">
        If you take the next call
      </h2>
      <p className="mt-[3px] text-[13.5px] leading-6 text-[#777166]">
        What to clarify, what to probe, and the logistics already covered.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <NextCallPrepCard
          icon={<WarningTriangle aria-hidden={true} className="h-4 w-4" />}
          iconClassName="bg-[#fbeae4] text-[#8a3a26]"
          items={prep.clarifyFirst}
          title="Clarify first"
        />
        <NextCallPrepCard
          icon={<Sparks aria-hidden={true} className="h-4 w-4" />}
          iconClassName="bg-[#eef0e3] text-olive-800"
          items={prep.worthProbing}
          title="Worth probing"
        />
        <NextCallPrepCard
          icon={<ShieldCheck aria-hidden={true} className="h-4 w-4" />}
          iconClassName="bg-[#effaf4] text-[#1a5037]"
          items={prep.alreadyCovered}
          title="Already covered"
        />
      </div>
    </section>
  );
}

function NextCallPrepCard({
  icon,
  iconClassName,
  items,
  title,
}: {
  icon: ReactNode;
  iconClassName: string;
  items: string[];
  title: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <article className="rounded-2xl border border-[#e7e2d8] bg-white px-[22px] py-5">
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] ${iconClassName}`}
        >
          {icon}
        </span>
        <p className="text-base font-semibold text-[#171715]">{title}</p>
      </div>
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            className="relative pl-[18px] text-[13.5px] leading-[1.55] text-[#5b574f] before:absolute before:left-0 before:top-[9px] before:h-[6px] before:w-[6px] before:rounded-full before:bg-[#cbc4b6]"
            key={item}
          >
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function GenerateBriefCard({
  detailPath,
  hasFailed,
  sessionId,
}: {
  detailPath: string;
  hasFailed: boolean;
  sessionId: string;
}) {
  return (
    <Card className="bg-[#f7f7ef] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Sparks aria-hidden="true" className="h-4 w-4" />
            Persist recruiter brief
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
            {hasFailed
              ? "The previous generation failed. Retry after reviewing the runtime evidence."
              : "Generate the durable recruiter brief from persisted transcript evidence."}
          </p>
        </div>
        <form action={generateCandidateBriefAction}>
          <input name="candidateSessionId" type="hidden" value={sessionId} />
          <input name="detailPath" type="hidden" value={detailPath} />
          <Button type="submit">
            <Sparks aria-hidden="true" className="h-4 w-4" />
            {hasFailed ? "Retry brief" : "Generate brief"}
          </Button>
        </form>
      </div>
    </Card>
  );
}

function AnalysisStateCard({
  displayedAnalysisStatus,
  eventCount,
  realtimeSessionId,
}: {
  displayedAnalysisStatus: string;
  eventCount: number;
  realtimeSessionId: string | null;
}) {
  return (
    <Card className="border-dashed bg-white/72 p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-olive-800">
          <WarningTriangle aria-hidden={true} className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink-950">
            {displayedAnalysisStatus === "not_ready"
              ? "Analysis is not ready"
              : "Analysis is pending"}
          </span>
          <span className="mt-2 block text-sm leading-6 text-ink-600">
            The persisted recruiter brief will appear after the completed live
            interview has persisted transcript turns and the generation action
            has run.
          </span>
          {realtimeSessionId ? (
            <span className="mt-3 block break-all text-xs font-medium text-ink-400">
              Session {realtimeSessionId} · {eventCount} events
            </span>
          ) : null}
        </span>
      </div>
    </Card>
  );
}

function DataLimitationsCard({
  brief,
  evidence,
  limitationsCount,
  questionCompletionRate,
}: {
  brief: CandidateBriefDto | null;
  evidence: CandidateSessionEvidence;
  limitationsCount: number;
  questionCompletionRate: number | null;
}) {
  const limitations = [
    ...deriveEvidenceLimitations({ evidence, questionCompletionRate }),
    ...(brief?.limitations ?? []),
  ];

  if (
    brief?.criteria.some((criterion) => criterion.status === "Not assessable")
  ) {
    limitations.push(
      "At least one criterion is not assessable from the available answers.",
    );
  }

  if (!brief) {
    limitations.push("Structured AI synthesis has not been persisted yet.");
  }

  if (brief) {
    return null;
  }

  return (
    <section className="flex items-start gap-[11px] rounded-[14px] bg-[#f1efe8] px-[17px] py-[15px]">
      <WarningTriangle
        aria-hidden={true}
        className="mt-px h-4 w-4 shrink-0 text-[#a29b8d]"
      />
      {limitations.length > 0 ? (
        <ul className="space-y-1">
          {Array.from(new Set(limitations)).map((limitation) => (
            <li
              key={limitation}
              className="text-xs leading-[1.6] text-[#8a8178]"
            >
              {limitation}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-[1.6] text-[#8a8178]">
          No limitation is currently flagged in persisted evidence or AI
          synthesis. Human review is still required.
        </p>
      )}
      {limitationsCount > 0 ? (
        <p className="sr-only">
          {limitationsCount} limitation
          {limitationsCount > 1 ? "s" : ""} came from the persisted brief.
        </p>
      ) : null}
    </section>
  );
}

function AuditGuardrailsPanel({
  eventCount,
  realtimeSessionId,
  transcriptTurnCount,
}: {
  eventCount: number;
  realtimeSessionId: string | null;
  transcriptTurnCount: number;
}) {
  return (
    <section className="flex items-start gap-[11px] rounded-[14px] bg-[#f1efe8] px-[17px] py-[15px]">
      <ShieldCheck
        aria-hidden={true}
        className="mt-px h-4 w-4 shrink-0 text-[#a29b8d]"
      />
      <p className="m-0 text-xs leading-[1.6] text-[#8a8178]">
        Generated from {eventCount} interview events and {transcriptTurnCount}{" "}
        transcript turns. Summaries describe evidence only — no hire or reject
        recommendation. Excluded from analysis: age, family status, national
        origin.
        {realtimeSessionId ? (
          <span className="block break-all">
            Session {realtimeSessionId}.
          </span>
        ) : null}
      </p>
    </section>
  );
}

function getSignalSummary(distribution: {
  "Not assessable": number;
  Medium: number;
  Strong: number;
  Weak: number;
}): SignalSummary {
  const missing = distribution["Not assessable"];
  const partial = distribution.Medium;
  const strong = distribution.Strong;
  const weak = distribution.Weak;

  return {
    missing,
    partial,
    strong,
    total: missing + partial + strong + weak,
    weak,
  };
}

function getKeyMoments(session: CandidateSessionReviewSession) {
  const firstStartedAt = session.evidence.transcriptTurns[0]?.startedAt ?? null;

  if (session.brief?.criteria.some((criterion) => criterion.evidence.length > 0)) {
    return session.brief.criteria
      .flatMap((criterion) =>
        criterion.evidence.slice(0, 1).map((item) => {
          const turn = item.transcriptTurnId
            ? session.evidence.transcriptTurns.find(
                (candidateTurn) =>
                  candidateTurn.turnId === item.transcriptTurnId,
              )
            : undefined;

          return {
            dot: criterionColor(criterion.status),
            label: criterion.label,
            quote: item.text,
            time: formatTurnTime(turn?.startedAt ?? null, firstStartedAt),
          };
        }),
      )
      .slice(0, 4);
  }

  const transcriptMoments = session.evidence.transcriptTurns
    .filter((turn) => turn.speaker !== "system")
    .slice(0, 4)
    .map((turn) => ({
      dot: turn.speaker === "candidate" ? "#5c7606" : "#a29b8d",
      label: turn.speaker === "candidate" ? "Candidate answer" : "Interviewer",
      quote: turn.text,
      time: formatTurnTime(turn.startedAt, firstStartedAt),
    }));

  return transcriptMoments.length > 0
    ? transcriptMoments
    : [
        {
          dot: "#a29b8d",
          label: "No transcript yet",
          quote:
            "The recording will show key moments once transcript turns are persisted.",
          time: "0:00",
        },
      ];
}

function getCriterionEvidenceCards(session: CandidateSessionReviewSession) {
  if (session.brief?.criteria.length) {
    return session.brief.criteria.map((criterion) => ({
      dot: criterionColor(criterion.status),
      id: criterion.criterionId,
      label: criterion.label,
      note: criterion.rationale,
      quote: criterion.evidence[0]?.text ?? null,
      status: criterion.status,
    }));
  }

  return session.questions.map((question) => ({
    dot: "#ddd8cc",
    id: question.id,
    label: question.expectedSignal,
    note:
      "AI synthesis has not been persisted yet. Review the transcript before making a decision.",
    quote: null,
    status: "Not assessable" as const,
  }));
}

function getNextCallPrep(session: CandidateSessionReviewSession) {
  const brief = session.brief;
  const missingInfo = brief?.evaluationMatrix?.missingInfo ?? [];
  const facts = brief?.evaluationMatrix?.facts ?? [];
  const strengths = brief?.strengths ?? [];
  const risks = brief?.risks ?? [];
  const pointsToClarify = brief?.pointsToClarify ?? [];

  return {
    alreadyCovered: uniqueNonEmpty([
      ...facts,
      ...strengths.map((strength) => normalizePrepItem(strength)),
    ]).slice(0, 2),
    clarifyFirst: uniqueNonEmpty([
      ...missingInfo,
      ...pointsToClarify,
      ...session.questions
        .filter((question) =>
          session.evidence.questionAnswerSequence.every(
            (group) =>
              group.questionId !== question.id ||
              group.candidateTurns.length === 0,
          ),
        )
        .map((question) => `Clarify ${question.expectedSignal.toLowerCase()}.`),
    ]).slice(0, 2),
    worthProbing: uniqueNonEmpty([
      ...risks,
      ...(brief?.evaluationMatrix?.recommendationRationale
        ? [brief.evaluationMatrix.recommendationRationale]
        : []),
    ]).slice(0, 2),
  };
}

function normalizePrepItem(value: string) {
  return value.endsWith(".") || value.endsWith("?") ? value : `${value}.`;
}

function uniqueNonEmpty(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function criterionColor(
  status: CandidateBriefDto["criteria"][number]["status"],
) {
  if (status === "Strong") {
    return "#5c7606";
  }

  if (status === "Medium") {
    return "#e1b855";
  }

  if (status === "Weak") {
    return "#d99a7b";
  }

  return "#ddd8cc";
}

function getRecordingDurationMs(
  turns: CandidateSessionEvidence["transcriptTurns"],
) {
  if (turns.length === 0) {
    return 0;
  }

  const first = new Date(turns[0]!.startedAt).getTime();
  const lastTurn = turns[turns.length - 1]!;
  const last = new Date(lastTurn.endedAt ?? lastTurn.startedAt).getTime();

  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return Math.max(turns.length * 18_000, 30_000);
  }

  return last - first;
}

function formatDurationLabel(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTurnTime(value: string | null, firstStartedAt: string | null) {
  if (!value || !firstStartedAt) {
    return "0:00";
  }

  const started = new Date(value).getTime();
  const first = new Date(firstStartedAt).getTime();

  if (!Number.isFinite(started) || !Number.isFinite(first) || started < first) {
    return "0:00";
  }

  return formatDurationLabel(started - first);
}

function formatCriteriaDistribution(distribution: {
  "Not assessable": number;
  Medium: number;
  Strong: number;
  Weak: number;
}) {
  const labels = [
    distribution.Strong > 0 ? `Strong ${distribution.Strong}` : null,
    distribution.Medium > 0 ? `Medium ${distribution.Medium}` : null,
    distribution.Weak > 0 ? `Weak ${distribution.Weak}` : null,
    distribution["Not assessable"] > 0
      ? `Not assessable ${distribution["Not assessable"]}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return labels.length > 0 ? labels.join(" · ") : "Brief pending";
}

function deriveEvidenceLimitations({
  evidence,
  questionCompletionRate,
}: {
  evidence: CandidateSessionEvidence;
  questionCompletionRate: number | null;
}) {
  const limitations: string[] = [];

  if (!evidence.realtimeSessionId) {
    limitations.push(
      "No realtime runtime session is linked to this candidate.",
    );
  }

  if (evidence.status !== "completed") {
    limitations.push("The live interview is not completed.");
  }

  if (evidence.eventCount === 0) {
    limitations.push("No persisted live events are available.");
  }

  if (evidence.transcriptTurns.length === 0) {
    limitations.push("No transcript turns are available.");
  }

  if (questionCompletionRate !== null && questionCompletionRate < 100) {
    limitations.push("Not every planned question has a completed answer.");
  }

  if (evidence.terminalEventType === "session_failed") {
    limitations.push("The runtime emitted a failed terminal event.");
  }

  if (evidence.runtimeStatus && evidence.runtimeStatus !== evidence.status) {
    limitations.push("Product session status and runtime status differ.");
  }

  return limitations;
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

function formatDateCompact(value: string | null) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function briefAnalysisStatus(
  brief: CandidateBriefDto,
): "available" | "failed" | "pending" | "not_ready" {
  if (brief.status === "completed") {
    return "available";
  }

  if (brief.status === "failed") {
    return "failed";
  }

  if (brief.status === "processing" || brief.status === "pending") {
    return "pending";
  }

  return "not_ready";
}

function briefCriterionTone(
  status: CandidateBriefDto["criteria"][number]["status"],
) {
  if (status === "Strong") {
    return "success";
  }

  if (status === "Medium") {
    return "olive";
  }

  if (status === "Weak") {
    return "warning";
  }

  return "muted";
}

function formatAnalysisStatus(status: string) {
  if (status === "available") {
    return "Analysis ready";
  }

  if (status === "pending") {
    return "Analysis pending";
  }

  if (status === "failed") {
    return "Analysis failed";
  }

  return "Not ready";
}
