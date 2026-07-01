"use client";

import * as React from "react";
import { Check, Link as LinkIcon, Pause, WarningTriangle } from "iconoir-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { UnderlineTabs, cn } from "@prelude/ui";
import type { CandidateInvitationSummary } from "../../server/interviews/candidate-invitations";

import { updateInterviewPublicationStatusAction } from "../../server/interviews/interview-actions";
import {
  CandidateScreensTable,
  isCandidateScreenInProgress,
  type CandidateScreenListItem,
} from "../candidate-screens";
import { CandidateInvitationsPanel } from "./candidate-invitations-panel";
import { CopyCandidateLinkButton } from "./copy-candidate-link-button";
import { InterviewSectionTitle } from "./interview-section-title";

type ReviewFilter =
  | "all"
  | "archived"
  | "in_progress"
  | "to_call"
  | "to_review";
type OverviewTab =
  | "candidates"
  | "invitations"
  | "overview"
  | "questions"
  | "settings";

export type InterviewOverviewQuestion = {
  id: string;
  numberLabel: string;
  prompt: string;
  signal: string;
  sourceLabel: string;
};

export type InterviewOverviewCriterion = {
  description: string;
  id: string;
  label: string;
};

export type InterviewOverviewSource = {
  mono: string;
  monoBg: string;
  monoFg: string;
  name: string;
  sub: string;
  title: string;
};

export type InterviewOverviewStat = {
  label: string;
  tone?: "danger" | "default";
  value: string;
};

export type InterviewOverviewConfigItem = {
  label: string;
  value: string;
};

export type InterviewOverviewTabsProps = {
  candidatePath: string;
  candidates: CandidateScreenListItem[];
  config: InterviewOverviewConfigItem[];
  criteria: InterviewOverviewCriterion[];
  guardrails: string[];
  interviewId: string;
  invitations: CandidateInvitationSummary[];
  publicationStatus: string;
  questions: InterviewOverviewQuestion[];
  roleBrief: string;
  roleTitle: string;
  source: InterviewOverviewSource | null;
  stats: InterviewOverviewStat[];
  summaryLine: string;
};

const filterValues: ReviewFilter[] = [
  "all",
  "to_review",
  "to_call",
  "in_progress",
  "archived",
];

function filterLabel(value: ReviewFilter, t: TFunction) {
  if (value === "all") {
    return t("interviewDetail.candidatesFilterAll");
  }

  if (value === "to_review") {
    return t("interviewDetail.candidatesFilterToReview");
  }

  if (value === "to_call") {
    return t("interviewDetail.candidatesFilterToCall");
  }

  if (value === "in_progress") {
    return t("interviewDetail.candidatesFilterInProgress");
  }

  return t("interviewDetail.candidatesFilterArchived");
}

export function InterviewOverviewTabs({
  candidatePath,
  candidates,
  config,
  criteria,
  guardrails,
  interviewId,
  invitations,
  publicationStatus,
  questions,
  roleBrief,
  roleTitle,
  source,
  stats,
  summaryLine,
}: InterviewOverviewTabsProps) {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<OverviewTab>("overview");
  const needsReviewCount = React.useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          candidate.reviewStatus === "to_review" &&
          !isCandidateScreenInProgress(candidate.status),
      ).length,
    [candidates],
  );

  return (
    <section className="mt-[26px]">
      <UnderlineTabs
        ariaLabel={t("interviewDetail.tabsAria")}
        onValueChange={setTab}
        options={[
          { label: t("interviewDetail.tabOverview"), value: "overview" },
          {
            count: needsReviewCount > 0 ? needsReviewCount : undefined,
            label: t("interviewDetail.tabCandidates"),
            value: "candidates",
          },
          {
            count: invitations.length > 0 ? invitations.length : undefined,
            label: t("interviewDetail.tabInvitations"),
            value: "invitations",
          },
          {
            count: questions.length,
            label: t("interviewDetail.tabQuestions"),
            value: "questions",
          },
          { label: t("interviewDetail.tabSettings"), value: "settings" },
        ]}
        value={tab}
      />

      {tab === "overview" ? (
        <OverviewPanel
          criteria={criteria}
          roleBrief={roleBrief}
          source={source}
          stats={stats}
        />
      ) : null}
      {tab === "candidates" ? (
        <CandidatesPanel candidates={candidates} summaryLine={summaryLine} />
      ) : null}
      {tab === "invitations" ? (
        <CandidateInvitationsPanel
          interviewId={interviewId}
          invitations={invitations}
          publicationStatus={publicationStatus}
          roleTitle={roleTitle}
        />
      ) : null}
      {tab === "questions" ? <QuestionsPanel questions={questions} /> : null}
      {tab === "settings" ? (
        <SettingsPanel
          candidatePath={candidatePath}
          config={config}
          guardrails={guardrails}
          interviewId={interviewId}
          publicationStatus={publicationStatus}
          roleTitle={roleTitle}
        />
      ) : null}
    </section>
  );
}

function OverviewPanel({
  criteria,
  roleBrief,
  source,
  stats,
}: {
  criteria: InterviewOverviewCriterion[];
  roleBrief: string;
  source: InterviewOverviewSource | null;
  stats: InterviewOverviewStat[];
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-6 flex flex-col gap-[30px]">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            className="rounded-[14px] border border-[#e7e2d8] bg-white px-4 py-[15px]"
            key={stat.label}
          >
            <p
              className={cn(
                "text-[26px] font-semibold leading-none tracking-[-0.02em]",
                stat.tone === "danger" ? "text-[#9c3b25]" : "text-ink-950",
              )}
            >
              {stat.value}
            </p>
            <p className="mt-[5px] text-xs text-[#8a8178]">{stat.label}</p>
          </div>
        ))}
      </section>

      {source ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e7e2d8] bg-white px-[18px] py-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl text-[15px] font-bold tracking-[-0.02em]"
              style={{ background: source.monoBg, color: source.monoFg }}
            >
              {source.mono}
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-ink-950">
                {source.title}
              </span>
              <span className="mt-[3px] block truncate text-[12.5px] text-[#8a8178]">
                {source.sub}
              </span>
            </span>
          </div>
          <button
            className="inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-full border border-[#ddd8cc] bg-white px-[15px] text-[13px] font-semibold text-ink-950 transition hover:border-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            type="button"
          >
            {t("interviewDetail.viewOriginalOffer")}
            <LinkIcon aria-hidden={true} className="h-3.5 w-3.5" />
          </button>
        </section>
      ) : null}

      <section>
        <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a29b8d]">
          {t("interviewDetail.roleBriefLabel")}
        </p>
        <p className="mt-[9px] max-w-[62ch] text-[15px] leading-[1.6] text-[#5b574f]">
          {roleBrief || t("interviewDetail.roleBriefEmpty")}
        </p>
      </section>

      <section>
        <InterviewSectionTitle
          description={t("interviewDetail.criteriaDescription")}
          title={t("interviewDetail.criteriaTitle")}
        />
        <div className="mt-3.5 grid gap-2 md:grid-cols-2">
          {criteria.length > 0 ? (
            criteria.map((criterion) => (
              <article
                className="rounded-[13px] border border-[#e7e2d8] bg-white px-[15px] py-[13px]"
                key={criterion.id}
              >
                <p className="text-[13.5px] font-semibold text-ink-950">
                  {criterion.label}
                </p>
                <p className="mt-1 text-[12.5px] leading-[1.45] text-[#787367]">
                  {criterion.description}
                </p>
              </article>
            ))
          ) : (
            <EmptyInlineState text={t("interviewDetail.criteriaEmpty")} />
          )}
        </div>
      </section>
    </div>
  );
}

function CandidatesPanel({
  candidates,
  summaryLine,
}: {
  candidates: CandidateScreenListItem[];
  summaryLine: string;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const visibleCandidates = React.useMemo(
    () => candidates.filter((candidate) => matchesFilter(candidate, filter)),
    [candidates, filter],
  );

  return (
    <div className="mt-[22px]">
      <p className="mb-3.5 text-[13.5px] leading-6 text-[#777166]">
        {summaryLine}
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {filterValues.map((value) => {
          const active = value === filter;
          const count = candidates.filter((candidate) =>
            matchesFilter(candidate, value),
          ).length;

          return (
            <button
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-full border px-[13px] text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
                active
                  ? "border-[#e2e6d3] bg-[#eef0e3] text-olive-950"
                  : "border-[#e7e2d8] bg-white text-[#5b574f] hover:border-[#cbc4b6] hover:text-ink-950",
              )}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {filterLabel(value, t)}
              <span
                className={cn(
                  "text-[11.5px] font-bold",
                  active ? "text-olive-900" : "text-[#a29b8d]",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <CandidateScreensTable
        candidates={visibleCandidates}
        className="mt-0 rounded-[18px] border-[#e7e2d8] bg-white"
        emptyDescription={t("interviewDetail.candidatesEmptyDescription")}
        emptyTitle={t("interviewDetail.candidatesEmptyTitle")}
      />
    </div>
  );
}

function QuestionsPanel({
  questions,
}: {
  questions: InterviewOverviewQuestion[];
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-6">
      <InterviewSectionTitle
        description={t("interviewDetail.scriptDescription")}
        title={t("interviewDetail.scriptTitle")}
      />
      <div className="mt-4 flex flex-col gap-2.5">
        {questions.length > 0 ? (
          questions.map((question) => (
            <article
              className="flex gap-[15px] rounded-2xl border border-[#e7e2d8] bg-white px-[18px] py-4"
              key={question.id}
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#eef0e3] text-[11.5px] font-bold text-olive-900">
                {question.numberLabel}
              </span>
              <span className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-[1.45] text-ink-950">
                  {question.prompt}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[#8a8178]">
                  <span className="font-semibold text-[#6f6a5f]">
                    {t("interviewDetail.signalLabel")}
                  </span>
                  {question.signal}
                  <span className="text-[#c0b9aa]"> · </span>
                  {question.sourceLabel}
                </p>
              </span>
            </article>
          ))
        ) : (
          <EmptyInlineState text={t("interviewDetail.questionsEmpty")} />
        )}
      </div>
    </div>
  );
}

function SettingsPanel({
  candidatePath,
  config,
  guardrails,
  interviewId,
  publicationStatus,
  roleTitle,
}: {
  candidatePath: string;
  config: InterviewOverviewConfigItem[];
  guardrails: string[];
  interviewId: string;
  publicationStatus: string;
  roleTitle: string;
}) {
  const { t } = useTranslation();
  const isPaused = publicationStatus === "paused";
  const nextStatus = isPaused ? "published" : "paused";

  return (
    <div className="mt-6 flex flex-col gap-[30px]">
      <section>
        <InterviewSectionTitle
          description={t("interviewDetail.configDescription")}
          title={t("interviewDetail.configTitle")}
        />
        <div className="mt-3.5 overflow-hidden rounded-2xl border border-[#e7e2d8] bg-white">
          {config.map((item) => (
            <div
              className="flex items-center justify-between gap-4 border-b border-[#f0ece1] px-[18px] py-3.5 last:border-b-0"
              key={item.label}
            >
              <span className="text-[13.5px] font-semibold text-ink-950">
                {item.label}
              </span>
              <span className="text-right text-[13px] text-[#5b574f]">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#e7e2d8] bg-white px-[18px] py-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ink-950">
            {t("interviewDetail.candidateLinkTitle")}
          </p>
          <p className="mt-1 truncate text-[12.5px] text-[#8a8178]">
            {candidatePath}
          </p>
        </div>
        <CopyCandidateLinkButton candidatePath={candidatePath}>
          {t("interviewDetail.copyLink")}
        </CopyCandidateLinkButton>
      </section>

      <section>
        <InterviewSectionTitle
          description={t("interviewDetail.guardrailsDescription")}
          title={t("interviewDetail.guardrailsTitle")}
        />
        <div className="mt-3.5 flex flex-col gap-[11px] px-0.5 py-1">
          {guardrails.length > 0 ? (
            guardrails.map((guardrail) => (
              <div className="flex items-start gap-2.5" key={guardrail}>
                <Check
                  aria-hidden={true}
                  className="mt-0.5 h-[15px] w-[15px] shrink-0 text-olive-800"
                />
                <p className="text-[13px] leading-[1.5] text-[#5b574f]">
                  {guardrail}
                </p>
              </div>
            ))
          ) : (
            <EmptyInlineState text={t("interviewDetail.guardrailsEmpty")} />
          )}
        </div>
      </section>

      <section
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-[18px] py-4",
          isPaused
            ? "border-[#dfe7ca] bg-[#f7f9ef]"
            : "border-[#efdcd5] bg-[#fdf6f3]",
        )}
      >
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-semibold",
              isPaused ? "text-olive-900" : "text-[#7a2d1c]",
            )}
          >
            {isPaused
              ? t("interviewDetail.resumeRoleTitle")
              : t("interviewDetail.pauseRoleTitle")}
          </p>
          <p
            className={cn(
              "mt-1 text-[12.5px] leading-[1.45]",
              isPaused ? "text-olive-800" : "text-[#9c6453]",
            )}
          >
            {isPaused
              ? t("interviewDetail.resumeRoleBody", { roleTitle })
              : t("interviewDetail.pauseRoleBody", { roleTitle })}
          </p>
        </div>
        <form action={updateInterviewPublicationStatusAction}>
          <input name="interviewId" type="hidden" value={interviewId} />
          <input name="nextStatus" type="hidden" value={nextStatus} />
          <button
            className={cn(
              "inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-full border bg-white px-4 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2",
              isPaused
                ? "border-[#d4ddbd] text-olive-900 hover:border-olive-800 focus-visible:ring-olive-300"
                : "border-[#e0b5a8] text-[#9a3417] hover:border-[#9a3417] focus-visible:ring-coral-100",
            )}
            type="submit"
          >
            <Pause aria-hidden={true} className="h-4 w-4" />
            {isPaused
              ? t("interviewDetail.resumeRoleButton")
              : t("interviewDetail.pauseRoleButton")}
          </button>
        </form>
      </section>

      <section className="flex gap-2.5 rounded-2xl border border-[#e7e2d8] bg-[#f7f7ef] px-4 py-3 text-sm leading-6 text-[#5b574f]">
        <WarningTriangle
          aria-hidden={true}
          className="mt-0.5 h-4 w-4 shrink-0 text-olive-800"
        />
        <p>{t("interviewDetail.humanReviewNotice")}</p>
      </section>
    </div>
  );
}

function EmptyInlineState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d8d2c4] bg-white/70 px-4 py-6 text-center text-[13px] text-[#8a8178]">
      {text}
    </div>
  );
}

function matchesFilter(
  candidate: CandidateScreenListItem,
  filter: ReviewFilter,
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "in_progress") {
    return isCandidateScreenInProgress(candidate.status);
  }

  return (
    candidate.reviewStatus === filter &&
    !isCandidateScreenInProgress(candidate.status)
  );
}
