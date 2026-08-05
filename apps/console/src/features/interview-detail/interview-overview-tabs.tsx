"use client";

import * as React from "react";
import { Check, Link as LinkIcon, WarningTriangle } from "iconoir-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { UnderlineTabs, cn } from "@prelude/ui";
import type { CandidateInvitationSummary } from "../../server/interviews/candidate-invitations";

import {
  CandidateQueueTable,
  isCandidateScreenInProgress,
  type CandidateQueueRow,
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
type OverviewTab = "candidates" | "settings" | "setup";

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
  note: string;
  tone?: "danger" | "default";
  value: string;
};

export type InterviewOverviewConfigItem = {
  label: string;
  value: string;
};

export type InterviewOverviewTabsProps = {
  candidatePath: string;
  candidates: CandidateQueueRow[];
  canManageRole: boolean;
  config: InterviewOverviewConfigItem[];
  criteria: InterviewOverviewCriterion[];
  guardrails: string[];
  interviewId: string;
  invitations: CandidateInvitationSummary[];
  onStatusChange: (formData: FormData) => Promise<void>;
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
  canManageRole,
  config,
  criteria,
  guardrails,
  interviewId,
  invitations,
  onStatusChange,
  publicationStatus,
  questions,
  roleBrief,
  roleTitle,
  source,
  stats,
  summaryLine,
}: InterviewOverviewTabsProps) {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<OverviewTab>("setup");
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
          { label: t("interviewDetail.tabSetup"), value: "setup" },
          {
            count: needsReviewCount > 0 ? needsReviewCount : undefined,
            label: t("interviewDetail.tabCandidates"),
            value: "candidates",
          },
          { label: t("interviewDetail.tabSettings"), value: "settings" },
        ]}
        value={tab}
      />

      {tab === "setup" ? (
        <SetupPanel
          criteria={criteria}
          questions={questions}
          roleBrief={roleBrief}
          source={source}
          stats={stats}
        />
      ) : null}
      {tab === "candidates" ? (
        <CandidatesPanel
          candidates={candidates}
          canManageRole={canManageRole}
          interviewId={interviewId}
          invitations={invitations}
          onStatusChange={onStatusChange}
          publicationStatus={publicationStatus}
          roleTitle={roleTitle}
          summaryLine={summaryLine}
        />
      ) : null}
      {tab === "settings" ? (
        <SettingsPanel
          candidatePath={candidatePath}
          config={config}
          guardrails={guardrails}
        />
      ) : null}
    </section>
  );
}

function SetupPanel({
  criteria,
  questions,
  roleBrief,
  source,
  stats,
}: {
  criteria: InterviewOverviewCriterion[];
  questions: InterviewOverviewQuestion[];
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
                "text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
                stat.tone === "danger" ? "text-[#9c3b25]" : "text-ink-950",
              )}
            >
              {stat.value}
            </p>
            <p className="mt-[5px] text-xs font-semibold text-ink-700">
              {stat.label}
            </p>
            <p className="mt-[3px] text-xs text-[#8a8178]">{stat.note}</p>
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
        <div className="mt-3.5 flex flex-col gap-2.5">
          {criteria.length > 0 || questions.length > 0 ? (
            pairCriteriaWithQuestions(criteria, questions).map((pair) => (
              <article
                className="grid gap-5 rounded-2xl border border-[#e7e2d8] bg-white px-[18px] py-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
                key={pair.key}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-[9px] text-sm font-semibold text-ink-950">
                    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#eef0e3] text-[11px] font-bold text-olive-900">
                      {pair.numberLabel}
                    </span>
                    {pair.criterion?.label ??
                      t("interviewDetail.criterionUnassigned")}
                  </p>
                  {pair.criterion ? (
                    <p className="mt-[7px] text-[12.5px] leading-[1.5] text-[#787367]">
                      {pair.criterion.description}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0 lg:border-l lg:border-[#f0ece1] lg:pl-5">
                  {pair.question ? (
                    <>
                      <p className="text-[14.5px] font-medium leading-[1.5] text-ink-800">
                        {pair.question.prompt}
                      </p>
                      <p className="mt-[7px] text-xs text-[#a29b8d]">
                        {pair.question.sourceLabel}
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-[#a29b8d]">
                      {t("interviewDetail.criterionNoQuestion")}
                    </p>
                  )}
                </div>
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
  canManageRole,
  interviewId,
  invitations,
  onStatusChange,
  publicationStatus,
  roleTitle,
  summaryLine,
}: {
  candidates: CandidateQueueRow[];
  canManageRole: boolean;
  interviewId: string;
  invitations: CandidateInvitationSummary[];
  onStatusChange: (formData: FormData) => Promise<void>;
  publicationStatus: string;
  roleTitle: string;
  summaryLine: string;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const visibleCandidates = React.useMemo(
    () => candidates.filter((candidate) => matchesFilter(candidate, filter)),
    [candidates, filter],
  );

  return (
    <div className="mt-[22px] flex flex-col gap-[18px]">
      <CandidateInvitationsPanel
        canManageRole={canManageRole}
        interviewId={interviewId}
        invitations={invitations}
        publicationStatus={publicationStatus}
        roleTitle={roleTitle}
      />

      <div>
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

        <div className="overflow-hidden rounded-[18px] border border-[#e7e2d8] bg-white">
          <CandidateQueueTable
            emptyNote={t("interviewDetail.candidatesEmptyDescription")}
            emptyTitle={t("interviewDetail.candidatesEmptyTitle")}
            onStatusChange={onStatusChange}
            rows={visibleCandidates}
          />
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  candidatePath,
  config,
  guardrails,
}: {
  candidatePath: string;
  config: InterviewOverviewConfigItem[];
  guardrails: string[];
}) {
  const { t } = useTranslation();

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

function matchesFilter(candidate: CandidateQueueRow, filter: ReviewFilter) {
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

// The generator emits one question per criterion; pairing by position keeps the
// setup view readable when the two lists drift out of sync.
function pairCriteriaWithQuestions(
  criteria: InterviewOverviewCriterion[],
  questions: InterviewOverviewQuestion[],
) {
  const length = Math.max(criteria.length, questions.length);

  return Array.from({ length }, (_unused, index) => ({
    criterion: criteria[index] ?? null,
    key: criteria[index]?.id ?? questions[index]?.id ?? String(index),
    numberLabel: String(index + 1).padStart(2, "0"),
    question: questions[index] ?? null,
  }));
}
