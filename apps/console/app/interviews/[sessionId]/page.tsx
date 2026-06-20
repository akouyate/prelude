import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { type CandidateBriefDto } from "@prelude/contracts";
import { Button, Card, EnterpriseShell, StatusBadge } from "@prelude/ui";
import {
  ArrowLeft,
  Calendar,
  ClipboardCheck,
  Clock,
  Community,
  EditPencil,
  Link as LinkIcon,
  Microphone,
  ShieldCheck,
  Sparks,
  UserBadgeCheck as UserRoundCheck,
  WarningTriangle,
} from "iconoir-react";

import { ConsoleAuthControls } from "../../../src/features/auth/console-auth-controls";
import { isConsoleAuthClerkEnabled } from "../../../src/server/auth/clerk-config";
import { getConsoleAuthContext } from "../../../src/server/auth/console-auth";
import { generateCandidateBriefAction } from "../../../src/server/interviews/candidate-brief-actions";
import { getInterviewDetail } from "../../../src/server/interviews/interview-loaders";
import type { CandidateSessionEvidence } from "../../../src/server/interviews/live-session-evidence";
import { requireCompletedOrganizationOnboarding } from "../../../src/server/onboarding/onboarding-guard";

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
  await requireCompletedOrganizationOnboarding();

  const { sessionId } = await params;
  const [account, detail] = await Promise.all([
    getConsoleAuthContext(),
    getInterviewDetail(sessionId),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <EnterpriseShell
      account={account}
      accountActions={
        <ConsoleAuthControls enabled={isConsoleAuthClerkEnabled} />
      }
      className="bg-[#fbfaf7]"
    >
      {detail.kind === "interview" ? (
        <InterviewOverview detail={detail} />
      ) : (
        <CandidateSessionReview session={detail.candidateSession} />
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
  const estimatedMinutes = getEstimatedMinutes(interview);
  const latestSession = interview.candidateSessions[0];

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-sm font-medium text-ink-600 transition hover:text-ink-950"
        href="/"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Dashboard
      </Link>

      <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch">
        <Card className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(interview.status)}>
              {formatStatus(interview.status)}
            </StatusBadge>
            <StatusBadge tone="neutral">
              {interview.questions.length} questions
            </StatusBadge>
            <StatusBadge tone="neutral">
              {formatModeSummary(interview.responseModes)}
            </StatusBadge>
          </div>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-normal text-ink-950 sm:text-5xl">
            {interview.roleTitle}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-600">
            {interview.roleBrief || "No role brief has been added yet."}
          </p>

          <dl className="mt-7 grid gap-3 sm:grid-cols-3">
            <DetailFact label="Job" value={interview.jobTitle} />
            <DetailFact label="Duration" value={`${estimatedMinutes} min`} />
            <DetailFact
              label="Updated"
              value={formatShortDate(interview.updatedAt)}
            />
          </dl>

          <div className="mt-7 flex flex-wrap gap-2">
            {interview.draftId ? (
              <Link
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-4 text-sm font-medium text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
                href={`/interviews/new?draftId=${interview.draftId}`}
              >
                <EditPencil aria-hidden="true" className="h-4 w-4" />
                Edit interview
              </Link>
            ) : null}
            <Link
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-ink-200 bg-white/80 px-4 text-sm font-medium text-ink-900 transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
              href="/interviews/new"
            >
              New interview
            </Link>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <LinkIcon aria-hidden="true" className="h-4 w-4" />
              Candidate entry point
            </div>
            <p className="mt-3 break-all rounded-2xl border border-ink-100 bg-white/72 px-3 py-3 text-sm font-semibold text-ink-950">
              {candidateLinkLabel}
            </p>
            <p className="mt-3 text-sm leading-6 text-ink-500">
              Share this link. Every started interview appears in the review
              queue below.
            </p>
          </div>
          <div className="mt-5 rounded-3xl bg-[#f7f7ef] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive-900">
              Latest activity
            </p>
            <p className="mt-2 text-sm font-semibold text-ink-950">
              {latestSession
                ? latestSession.candidateLabel
                : "No candidate yet"}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {latestSession
                ? `${formatStatus(latestSession.status)} · ${formatShortDate(
                    latestSession.completedAt ?? latestSession.startedAt,
                  )}`
                : "Waiting for the first interview start."}
            </p>
          </div>
        </Card>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
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
      </section>

      <section className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <section>
            <SectionHeading
              description="Open completed or in-progress sessions and inspect the recruiter recap."
              icon={<Calendar aria-hidden="true" className="h-4 w-4" />}
              title="Candidate review queue"
            />
            <div className="mt-4 overflow-hidden rounded-3xl border border-ink-100 bg-white/72">
              {interview.candidateSessions.length > 0 ? (
                <div className="divide-y divide-ink-100">
                  {interview.candidateSessions.map((session) => (
                    <Link
                      key={session.id}
                      className="group grid cursor-pointer gap-4 p-4 transition hover:bg-white sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.75fr)_auto] sm:items-center"
                      href={`/interviews/${session.realtimeSessionId ?? session.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-ink-950">
                          {session.candidateLabel}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                          <StatusBadge tone={statusTone(session.status)}>
                            {formatStatus(session.status)}
                          </StatusBadge>
                          <StatusBadge
                            tone={analysisStatusTone(session.analysisStatus)}
                          >
                            {formatAnalysisStatus(session.analysisStatus)}
                          </StatusBadge>
                        </span>
                      </span>
                      <span className="grid gap-2 text-sm text-ink-600 sm:grid-cols-2">
                        <ReviewFact
                          icon={
                            <Microphone
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          }
                          label={`${session.transcriptTurnCount} turns`}
                        />
                        <ReviewFact
                          icon={
                            <ClipboardCheck
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          }
                          label={
                            session.questionCompletionRate === null
                              ? "No script"
                              : `${session.questionCompletionRate}% complete`
                          }
                        />
                        <ReviewFact
                          icon={
                            <Clock aria-hidden="true" className="h-4 w-4" />
                          }
                          label={formatShortDate(session.startedAt)}
                        />
                        <ReviewFact
                          icon={
                            <Calendar aria-hidden="true" className="h-4 w-4" />
                          }
                          label={formatShortDate(session.completedAt)}
                        />
                      </span>
                      <span className="text-sm font-medium text-ink-900 transition group-hover:translate-x-0.5">
                        Review
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-5">
                  <p className="text-sm font-semibold text-ink-900">
                    No candidate session yet
                  </p>
                  <p className="mt-2 text-sm leading-6 text-ink-500">
                    Once a candidate starts the live interview, the session
                    appears here with analysis readiness and completion signals.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section>
            <SectionHeading
              description="What the live interviewer will ask, and the signal each answer should reveal."
              icon={<Microphone aria-hidden="true" className="h-4 w-4" />}
              title="Interview script"
            />
            <div className="mt-4 space-y-3">
              {interview.questions.map((question, index) => (
                <article
                  key={question.id}
                  className="rounded-3xl border border-ink-100 bg-white/76 p-4"
                >
                  <div className="flex gap-4">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-xs font-semibold text-olive-800">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <StatusBadge tone="muted">
                          {formatQuestionSource(question.source)}
                        </StatusBadge>
                        <span className="text-xs font-medium text-ink-400">
                          {Math.max(
                            1,
                            Math.round(question.durationSeconds / 60),
                          )}{" "}
                          min
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
          </section>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionHeading
              description="What reviewers should compare after the live screen."
              icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
              title="Evaluation matrix"
            />
            <div className="mt-4 space-y-2">
              {interview.criteria.map((criterion) => (
                <div
                  key={criterion.id}
                  className="rounded-2xl border border-ink-100 bg-white/62 p-3"
                >
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
            <SectionHeading
              description="Rules the interviewer and reviewer must preserve."
              icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
              title="Guardrails"
            />
            <div className="mt-4 space-y-2">
              {interview.guardrails.map((guardrail) => (
                <p
                  key={guardrail}
                  className="rounded-2xl border border-ink-100 bg-white/62 p-3 text-sm leading-6 text-ink-600"
                >
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

function CandidateSessionReview({
  session,
}: {
  session: {
    analysisStatus: "available" | "pending" | "not_ready" | "failed";
    brief: CandidateBriefDto | null;
    candidateLabel: string;
    completedAt: string | null;
    eventCount: number;
    evidence: CandidateSessionEvidence;
    id: string;
    interviewId: string;
    jobTitle: string;
    questionCompletionRate: number | null;
    realtimeSessionId: string | null;
    reviewStatus: "to_call" | "to_review" | "archived";
    roleTitle: string;
    startedAt: string | null;
    status: string;
    transcriptTurnCount: number;
  };
}) {
  const displayedAnalysisStatus = session.brief
    ? briefAnalysisStatus(session.brief)
    : session.analysisStatus;

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="inline-flex cursor-pointer items-center gap-2 rounded-full text-sm font-medium text-ink-600 transition hover:text-ink-950"
        href={`/interviews/${session.interviewId}`}
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Interview
      </Link>

      <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch">
        <Card className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(session.status)}>
              {formatStatus(session.status)}
            </StatusBadge>
            <StatusBadge tone={reviewStatusTone(session.reviewStatus)}>
              {formatReviewStatus(session.reviewStatus)}
            </StatusBadge>
            <StatusBadge tone={analysisStatusTone(displayedAnalysisStatus)}>
              {formatAnalysisStatus(displayedAnalysisStatus)}
            </StatusBadge>
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-normal text-ink-950">
            {session.candidateLabel}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-600">
            {session.roleTitle} · {session.jobTitle}
          </p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-ink-600">
            {session.brief?.summary ??
              "The candidate session is available. Generate the persisted recruiter brief from runtime evidence when the live interview is complete."}
          </p>
        </Card>

        <Card className="flex flex-col justify-between p-5">
          {session.brief?.status === "completed" ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive-900">
                Persisted brief
              </p>
              <h2 className="mt-3 text-2xl font-semibold leading-tight text-ink-950">
                {formatReviewStatus(
                  session.brief.suggestedNextStep ?? "to_review",
                )}
              </h2>
              <p className="mt-3 text-sm leading-6 text-ink-600">
                Generated from persisted transcript evidence. Human review is
                still required before any hiring decision.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                Review guardrail
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-600">
                Prelude supports human screening review. This page must not be
                used as an automated hiring or rejection decision.
              </p>
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <MiniFact
              label="Criteria met"
              value={
                session.brief
                  ? `${briefPositiveCriteria(session.brief)}/${session.brief.criteria.length}`
                  : "Not ready"
              }
            />
            <MiniFact
              label="To clarify"
              value={
                session.brief
                  ? String(session.brief.pointsToClarify.length)
                  : "Not ready"
              }
            />
          </div>
        </Card>
      </section>

      <InterviewPulse
        eventCount={session.eventCount}
        questionCompletionRate={session.questionCompletionRate}
        transcriptTurnCount={session.transcriptTurnCount}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-4">
          {session.brief ? <PersistedBriefCard brief={session.brief} /> : null}
          {session.evidence.status === "completed" &&
          session.brief?.status !== "completed" ? (
            <GenerateBriefCard
              detailPath={`/interviews/${session.realtimeSessionId ?? session.id}`}
              hasFailed={session.brief?.status === "failed"}
              sessionId={session.id}
            />
          ) : null}
          <RuntimeEvidenceCard evidence={session.evidence} />

          {!session.brief ? (
            <Card className="border-dashed bg-white/72 p-6">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef0e3] text-olive-800">
                  <WarningTriangle aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink-950">
                    {displayedAnalysisStatus === "not_ready"
                      ? "Analysis is not ready"
                      : "Analysis is pending"}
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-ink-600">
                    The persisted recruiter brief will appear after the
                    completed live interview has persisted transcript turns and
                    the generation action has run.
                  </span>
                  {session.realtimeSessionId ? (
                    <span className="mt-3 block break-all text-xs font-medium text-ink-400">
                      Session {session.realtimeSessionId} · {session.eventCount}{" "}
                      events
                    </span>
                  ) : null}
                </span>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
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

function RuntimeEvidenceCard({
  evidence,
}: {
  evidence: CandidateSessionEvidence;
}) {
  const previewTurns = evidence.transcriptTurns.slice(0, 5);

  return (
    <Card className="p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(evidence.status)}>
              {formatStatus(evidence.status)}
            </StatusBadge>
            {evidence.runtimeStatus ? (
              <StatusBadge tone="neutral">
                Runtime {formatStatus(evidence.runtimeStatus)}
              </StatusBadge>
            ) : (
              <StatusBadge tone="muted">No runtime session</StatusBadge>
            )}
            {evidence.terminalEventType ? (
              <StatusBadge tone="success">
                {formatStatus(evidence.terminalEventType)}
              </StatusBadge>
            ) : null}
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-ink-950">
            Runtime evidence
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            Reconstructed from persisted live events linked to this candidate
            session. This is the durable transcript source for analysis and
            recruiter review.
          </p>

          {previewTurns.length > 0 ? (
            <div className="mt-5 space-y-3">
              {previewTurns.map((turn) => (
                <div
                  key={`${turn.sequenceNumber}-${turn.turnId}`}
                  className="rounded-2xl border border-ink-100 bg-white/62 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                      {turn.speaker}
                    </p>
                    <span className="text-xs text-ink-400">
                      #{turn.sequenceNumber}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-700">
                    {turn.text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-ink-100 bg-white/54 p-3 text-sm leading-6 text-ink-500">
              No transcript turn has been persisted for this session yet.
            </p>
          )}
        </div>

        <div className="grid content-start gap-2">
          <MiniFact label="Events" value={String(evidence.eventCount)} />
          <MiniFact
            label="Transcript"
            value={`${evidence.transcriptTurns.length} turns`}
          />
          <MiniFact
            label="Q/A groups"
            value={String(evidence.questionAnswerSequence.length)}
          />
          <MiniFact
            label="Questions"
            value={
              evidence.questionCompletionRate === null
                ? "No script"
                : `${evidence.questionCompletionRate}%`
            }
          />
        </div>
      </div>
    </Card>
  );
}

function PersistedBriefCard({ brief }: { brief: CandidateBriefDto }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={analysisStatusTone(briefAnalysisStatus(brief))}>
          {formatAnalysisStatus(briefAnalysisStatus(brief))}
        </StatusBadge>
        <StatusBadge tone="neutral">Persisted brief</StatusBadge>
      </div>

      <h2 className="mt-4 text-2xl font-semibold text-ink-950">
        Recruiter brief
      </h2>
      {brief.summary ? (
        <p className="mt-2 text-sm leading-6 text-ink-600">{brief.summary}</p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <BriefColumn
          empty="No strength was extracted from the persisted evidence."
          title="Observed strengths"
          values={brief.strengths}
        />
        <BriefColumn
          empty="No clarification point has been generated yet."
          title="Clarify"
          values={brief.pointsToClarify}
        />
      </div>

      <div className="mt-5 divide-y divide-ink-100 overflow-hidden rounded-3xl border border-ink-100 bg-white/54">
        {brief.criteria.map((criterion) => (
          <div key={criterion.criterionId} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink-950">{criterion.label}</p>
              <StatusBadge tone={briefCriterionTone(criterion.status)}>
                {criterion.status}
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              {criterion.rationale}
            </p>
            {criterion.evidence.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {criterion.evidence.map((item) => (
                  <li
                    key={`${criterion.criterionId}-${item.transcriptTurnId ?? item.text}`}
                    className="rounded-2xl border border-ink-100 bg-white/62 p-3 text-sm leading-6 text-ink-600"
                  >
                    “{item.text}”
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>

      {brief.limitations.length > 0 ? (
        <div className="mt-5 rounded-3xl border border-ink-100 bg-[#f7f7ef] p-4">
          <p className="text-sm font-semibold text-ink-950">Limitations</p>
          <ul className="mt-3 space-y-2">
            {brief.limitations.map((limitation) => (
              <li key={limitation} className="text-sm leading-6 text-ink-600">
                {limitation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function BriefColumn({
  empty,
  title,
  values,
}: {
  empty: string;
  title: string;
  values: string[];
}) {
  return (
    <div className="rounded-3xl border border-ink-100 bg-white/62 p-4">
      <p className="text-sm font-semibold text-ink-950">{title}</p>
      {values.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {values.map((value) => (
            <li key={value} className="text-sm leading-6 text-ink-600">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-ink-500">{empty}</p>
      )}
    </div>
  );
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

  return "AI";
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

function formatShortDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
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

function statusTone(status: string) {
  if (status === "completed" || status === "needs_review") {
    return "danger";
  }

  if (status === "published") {
    return "dark";
  }

  if (status === "in_progress" || status === "waiting_candidate") {
    return "warning";
  }

  return "olive";
}

function reviewStatusTone(status: string) {
  if (status === "to_call") {
    return "success";
  }

  if (status === "archived") {
    return "muted";
  }

  return "danger";
}

function analysisStatusTone(status: string) {
  if (status === "available") {
    return "success";
  }

  if (status === "failed") {
    return "danger";
  }

  if (status === "pending") {
    return "warning";
  }

  return "muted";
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

function briefPositiveCriteria(brief: CandidateBriefDto) {
  return brief.criteria.filter(
    (criterion) =>
      criterion.status === "Strong" || criterion.status === "Medium",
  ).length;
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

function formatReviewStatus(status: string) {
  if (status === "to_call") {
    return "To call";
  }

  if (status === "to_review") {
    return "To review";
  }

  return "Archived";
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

function getSessionStats(
  sessions: Array<{
    completedAt: string | null;
    status: string;
  }>,
) {
  const completed = sessions.filter(
    (session) => session.status === "completed" || session.completedAt,
  ).length;
  const started = sessions.filter(
    (session) => session.status !== "created",
  ).length;

  return {
    completed,
    needsReview: completed,
    started,
  };
}

function SectionHeading({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon}
        {title}
      </div>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-500">
        {description}
      </p>
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/62 px-4 py-3">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink-950">
        {value}
      </dd>
    </div>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/68 px-3 py-3">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink-950">{value}</p>
    </div>
  );
}

function InterviewPulse({
  eventCount,
  questionCompletionRate,
  transcriptTurnCount,
}: {
  eventCount: number;
  questionCompletionRate: number | null;
  transcriptTurnCount: number;
}) {
  const questionRate = questionCompletionRate ?? 0;
  const transcriptRate = Math.min(100, transcriptTurnCount * 12.5);
  const evidenceRate = Math.min(100, eventCount * 12.5);

  return (
    <Card className="mt-5 p-5">
      <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-center">
        <div className="self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive-900">
            Interview pulse
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <PulseBar
            label="Questions answered"
            percent={questionRate}
            tone="olive"
            value={
              questionCompletionRate === null ? "No script" : `${questionRate}%`
            }
          />
          <PulseBar
            label="Transcript depth"
            percent={transcriptRate}
            tone="ink"
            value={`${transcriptTurnCount} turns`}
          />
          <PulseBar
            label="Evidence captured"
            percent={evidenceRate}
            tone="gold"
            value={`${eventCount} events`}
          />
        </div>
      </div>
    </Card>
  );
}

function PulseBar({
  label,
  percent,
  tone,
  value,
}: {
  label: string;
  percent: number;
  tone: "gold" | "ink" | "olive";
  value: string;
}) {
  const barColor =
    tone === "gold" ? "#ead777" : tone === "ink" ? "#171715" : "#718033";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink-600">{label}</p>
        <p className="text-sm font-semibold text-ink-950">{value}</p>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full"
          style={{
            backgroundColor: barColor,
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,.28) 0, rgba(255,255,255,.28) 2px, transparent 2px, transparent 6px)",
            width: `${Math.max(4, Math.min(100, percent))}%`,
          }}
        />
      </div>
    </div>
  );
}

function ReviewFact({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="text-ink-400">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
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
    <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white/68 px-4 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-white">
        {icon}
      </span>
      <span>
        <span className="block text-xs font-medium text-ink-500">{label}</span>
        <span className="block text-xl font-semibold text-ink-950">
          {value}
        </span>
      </span>
    </div>
  );
}
