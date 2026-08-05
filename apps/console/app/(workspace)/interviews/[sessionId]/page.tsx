import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { type CandidateBriefDto } from "@prelude/contracts";
import { Card, IconButton } from "@prelude/ui";
import {
  ArrowLeft,
  NavArrowLeft,
  NavArrowRight,
  WarningTriangle,
} from "iconoir-react";

import { getConsoleAuthContext } from "../../../../src/server/auth/console-auth";
import { AutoGenerateBrief } from "../../../../src/features/interview-detail/auto-generate-brief";
import { shouldAutoGenerateBrief } from "../../../../src/features/interview-detail/brief-auto-generation";
import {
  saveCandidateReviewNoteAction,
  updateCandidateReviewStatusAction,
} from "../../../../src/server/interviews/candidate-review-actions";
import { generateCandidateBriefAction } from "../../../../src/server/interviews/candidate-brief-actions";
import { getConnectedAccountCapabilityStatus } from "../../../../src/server/integrations/connected-account-service";
import {
  connectedAccountCapabilityCalendar,
  connectedAccountProviderGoogle,
} from "../../../../src/server/integrations/connected-account-types";
import { getInterviewDetail } from "../../../../src/server/interviews/interview-loaders";
import {
  getCandidateSessionSiblings,
  type CandidateSessionSiblings,
} from "../../../../src/server/interviews/candidate-session-siblings";
import type { CandidateSessionEvidence } from "../../../../src/server/interviews/live-session-evidence";
import type { LiveAnalysisStatus } from "../../../../src/server/interviews/live-session-insights";
import { canManageCandidateReview } from "../../../../src/domain/candidate-review-policy";
import { initialsForCandidate } from "../../../../src/features/candidate-screens";
import { CandidateDecisionBar } from "../../../../src/features/interview-detail/candidate-decision-bar";
import { CandidateReviewNote } from "../../../../src/features/interview-detail/candidate-review-note";
import { buildReviewCriteria } from "../../../../src/features/interview-detail/candidate-review-model";
import {
  CandidateConfirmedSection,
  CandidateCoveredCallout,
  CandidateGapsSection,
  CandidateVerdictSection,
} from "../../../../src/features/interview-detail/candidate-review-sections";
import {
  CandidateTranscriptDrawer,
  type TranscriptDrawerTurn,
} from "../../../../src/features/interview-detail/candidate-transcript-drawer";
import { CandidateVoicePlayer } from "../../../../src/features/interview-detail/candidate-voice-player";
import {
  buildInterviewReplayChapters,
  replayOffsetMs,
  replayOriginMs,
} from "../../../../src/features/interview-detail/interview-replay";
import { InterviewReplayProvider } from "../../../../src/features/interview-detail/interview-replay-controller";
import { DeleteRecordingButton } from "../../../../src/features/interview-detail/delete-recording-button";
import { CandidateScheduleCta } from "../../../../src/features/interview-detail/candidate-schedule-cta";
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

  const [calendarConnectionStatus, siblings] = await Promise.all([
    getConnectedAccountCapabilityStatus({
      capability: connectedAccountCapabilityCalendar,
      organizationId: account.organizationId,
      provider: connectedAccountProviderGoogle,
      userId: account.userId,
    }),
    getCandidateSessionSiblings({
      candidateSessionId: detail.candidateSession.id,
      interviewId: detail.candidateSession.interviewId,
      organizationId: account.organizationId,
    }),
  ]);

  return (
    <CandidateSessionReview
      canDelete={canDeleteRecording(account.role)}
      canManageReview={canManageCandidateReview(account.role)}
      calendarConnectionStatus={calendarConnectionStatus}
      session={detail.candidateSession}
      siblings={siblings}
    />
  );
}

function CandidateSessionReview({
  canDelete,
  canManageReview,
  calendarConnectionStatus,
  session,
  siblings,
}: {
  canDelete: boolean;
  canManageReview: boolean;
  siblings: CandidateSessionSiblings;
  calendarConnectionStatus:
    | "connected"
    | "connecting"
    | "error"
    | "expired"
    | "needs_reconnect"
    | "not_connected"
    | "revoked";
  session: {
    analysisStatus: LiveAnalysisStatus;
    brief: CandidateBriefDto | null;
    candidateEmail: string | null;
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
    scheduledCall: {
      conferenceJoinUrl: string | null;
      conferencePending: boolean;
      eventUrl: string | null;
      invitationSent: boolean;
      startsAt: string;
      status: "provider_error" | "scheduled";
      timeZone: string;
    } | null;
    startedAt: string | null;
    status: string;
    transcriptTurnCount: number;
  };
}) {
  const detailPath = `/interviews/${session.realtimeSessionId ?? session.id}`;
  // Bound to primitives only: the inline action below serialises whatever it
  // closes over, and `session` carries the whole transcript and brief.
  const candidateSessionId = session.id;
  const replayDurationMs = getRecordingDurationMs(
    session.evidence.transcriptTurns,
  );
  const replayChapters = buildInterviewReplayChapters({
    questionAnswerSequence: session.evidence.questionAnswerSequence,
    questions: session.questions,
    totalDurationMs: session.evidence.recording?.durationMs ?? replayDurationMs,
    transcriptTurns: session.evidence.transcriptTurns,
  });
  const criteria = buildReviewCriteria({
    brief: session.brief,
    transcriptTurns: session.evidence.transcriptTurns,
  });
  const confirmedCriteria = criteria.filter(
    (criterion) => criterion.status === "strong",
  );
  const openCriteria = criteria.filter(
    (criterion) => criterion.status !== "strong",
  );
  const candidateInitials = initialsForCandidate(session.candidateLabel);
  const replayOrigin = replayOriginMs(session.evidence.transcriptTurns);
  const transcriptTurns: TranscriptDrawerTurn[] =
    session.evidence.transcriptTurns.map((turn) => ({
      offsetMs: replayOffsetMs(turn.startedAt, replayOrigin),
      speaker: turn.speaker,
      speakerLabel:
        turn.speaker === "candidate"
          ? session.candidateLabel
          : turn.speaker === "interviewer"
            ? "HireCall · interviewer"
            : "System",
      text: turn.text,
      turnId: turn.turnId,
    }));
  const limitations = Array.from(
    new Set([
      ...deriveEvidenceLimitations({
        evidence: session.evidence,
        questionCompletionRate: session.questionCompletionRate,
      }),
      ...(session.brief?.limitations ?? []),
    ]),
  );

  return (
    <InterviewReplayProvider>
      <main className="mx-auto max-w-[760px] pb-[140px]">
        <div className="flex items-center justify-between gap-4">
          <Link
            className="inline-flex cursor-pointer items-center gap-[7px] font-title text-[13px] font-semibold text-ink-500 transition hover:text-ink-950"
            href="/candidates"
          >
            <ArrowLeft aria-hidden={true} className="h-4 w-4" />
            {session.roleTitle}
          </Link>
          <div className="hidden items-center gap-[9px] sm:flex">
            <span className="font-title text-[12.5px] font-medium text-ink-400">
              {siblings.position} of {siblings.total}
            </span>
            <PagerButton
              href={siblings.previousHref}
              label="Previous candidate"
            >
              <NavArrowLeft aria-hidden={true} className="h-4 w-4" />
            </PagerButton>
            <PagerButton href={siblings.nextHref} label="Next candidate">
              <NavArrowRight aria-hidden={true} className="h-4 w-4" />
            </PagerButton>
          </div>
        </div>

        <header className="mt-[22px] flex items-center gap-[15px] max-[680px]:flex-col max-[680px]:items-start">
          <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-[#eef0e3] font-title text-[18px] font-semibold text-olive-900">
            {candidateInitials}
          </span>
          <div className="min-w-0">
            <h1 className="font-title text-[clamp(24px,2.6vw,30px)] font-semibold leading-[1.12] tracking-[-0.026em] text-ink-950">
              {session.candidateLabel}
            </h1>
            <p className="mt-1.5 text-[13px] leading-[1.5] text-[#8a8178]">
              {[
                session.jobTitle,
                session.candidateEmail,
                `interviewed ${formatDateCompact(session.completedAt ?? session.startedAt)}`,
                formatDurationLabel(replayDurationMs),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </header>

        <CandidateVerdictSection
          criteria={criteria}
          summary={session.brief?.summary ?? null}
        />

        <CandidateVoicePlayer
          chapters={replayChapters}
          fallbackDurationMs={replayDurationMs}
          recording={session.evidence.recording}
        />

        {session.brief?.status === "completed" ? null : (
          <BriefPendingSection
            briefStatus={session.brief?.status}
            detailPath={detailPath}
            eventCount={session.eventCount}
            evidenceStatus={session.evidence.status}
            realtimeSessionId={session.realtimeSessionId}
            sessionId={session.id}
          />
        )}

        <CandidateGapsSection criteria={openCriteria} />
        <CandidateConfirmedSection criteria={confirmedCriteria} />
        <CandidateCoveredCallout
          facts={session.brief?.evaluationMatrix?.facts ?? []}
        />

        <CandidateReviewNote
          canManageReview={canManageReview}
          onSave={async (note: string) => {
            "use server";

            await saveCandidateReviewNoteAction({
              candidateSessionId,
              detailPath,
              reviewNote: note,
            });
          }}
          reviewNote={session.reviewNote}
        />

        {limitations.length > 0 ? (
          <section className="mt-5 flex items-start gap-[11px] rounded-[14px] bg-[#f1efe8] px-4 py-3.5">
            <WarningTriangle
              aria-hidden={true}
              className="mt-px h-4 w-4 shrink-0 text-ink-400"
            />
            <ul className="space-y-1">
              {limitations.map((limitation) => (
                <li
                  className="text-xs leading-[1.6] text-[#8a8178]"
                  key={limitation}
                >
                  {limitation}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-[26px] flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-[70ch] text-[11.5px] leading-[1.6] text-ink-400">
            Generated from {session.eventCount} interview events and{" "}
            {session.transcriptTurnCount} transcript turns. Evidence only — no
            hire or reject recommendation. Age, family status and national
            origin are excluded from analysis.
            {session.realtimeSessionId ? (
              <span className="block break-all">
                Session {session.realtimeSessionId}.
              </span>
            ) : null}
          </p>
          {canDelete && session.evidence.recording?.status === "available" ? (
            <DeleteRecordingButton
              canDelete={canDelete}
              candidateSessionId={session.id}
              recordingStatus={session.evidence.recording.status}
            />
          ) : null}
        </div>

        <CandidateDecisionBar
          canManageReview={canManageReview}
          onDecide={updateCandidateReviewStatusAction}
          reviewStatus={session.reviewStatus}
          scheduleAction={
            <CandidateScheduleCta
              candidateEmail={session.candidateEmail}
              candidateLabel={session.candidateLabel}
              canSchedule={canManageReview}
              connectionStatus={calendarConnectionStatus}
              detailPath={detailPath}
              roleTitle={session.roleTitle}
              scheduledCall={session.scheduledCall}
              sessionId={session.id}
            />
          }
          sessionId={session.id}
        />

        <CandidateTranscriptDrawer
          candidateInitials={candidateInitials}
          turns={transcriptTurns}
        />
      </main>
    </InterviewReplayProvider>
  );
}

function PagerButton({
  children,
  href,
  label,
}: {
  children: ReactNode;
  href: string | null;
  label: string;
}) {
  if (!href) {
    return (
      <IconButton
        aria-label={label}
        className="rounded-lg border-[#e7e2d8]"
        disabled
        size="sm"
      >
        {children}
      </IconButton>
    );
  }

  return (
    <Link
      aria-label={label}
      className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#e7e2d8] bg-white text-ink-600 transition hover:border-ink-900 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
      href={href}
    >
      {children}
    </Link>
  );
}

function BriefPendingSection({
  briefStatus,
  detailPath,
  eventCount,
  evidenceStatus,
  realtimeSessionId,
  sessionId,
}: {
  briefStatus: CandidateBriefDto["status"] | undefined;
  detailPath: string;
  eventCount: number;
  evidenceStatus: CandidateSessionEvidence["status"];
  realtimeSessionId: string | null;
  sessionId: string;
}) {
  if (
    evidenceStatus === "completed" &&
    shouldAutoGenerateBrief(evidenceStatus, briefStatus)
  ) {
    // Evidence is ready and no usable brief exists yet — generate without
    // waiting for a manual click.
    return (
      <div className="mt-[30px]">
        <AutoGenerateBrief detailPath={detailPath} sessionId={sessionId} />
      </div>
    );
  }

  return (
    <Card className="mt-[30px] border-dashed bg-white/72 p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-olive-800">
          <WarningTriangle aria-hidden={true} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-950">
            {briefStatus === "failed"
              ? "Analysis failed"
              : "Analysis is not ready"}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            The recruiter brief appears once the completed live interview has
            persisted transcript turns and synthesis has run.
          </p>
          {realtimeSessionId ? (
            <p className="mt-3 break-all text-xs font-medium text-ink-400">
              Session {realtimeSessionId} · {eventCount} events
            </p>
          ) : null}
          {evidenceStatus === "completed" ? (
            <form action={generateCandidateBriefAction}>
              <input name="candidateSessionId" type="hidden" value={sessionId} />
              <input name="detailPath" type="hidden" value={detailPath} />
              <button
                className="mt-3.5 inline-flex h-[34px] cursor-pointer items-center rounded-full border border-ink-200 bg-white px-3.5 text-[12.5px] font-semibold text-ink-950 transition hover:border-ink-900"
                type="submit"
              >
                {briefStatus === "failed"
                  ? "Retry analysis"
                  : "Generate the brief"}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </Card>
  );
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

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatDateCompact(value: string | null) {
  if (!value) {
    return "no date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
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
