"use client";

import * as React from "react";
import { CheckCircle, WarningTriangle } from "iconoir-react";
import { UnderlineTabs, cn } from "@prelude/ui";

import {
  CandidateScreensTable,
  isCandidateScreenInProgress,
  type CandidateScreenListItem,
} from "../candidate-screens";

type ReviewFilter = "all" | "archived" | "in_progress" | "to_call" | "to_review";
type OverviewTab = "candidates" | "setup";

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

export type InterviewOverviewTabsProps = {
  candidates: CandidateScreenListItem[];
  criteria: InterviewOverviewCriterion[];
  guardrails: string[];
  questions: InterviewOverviewQuestion[];
  roleBrief: string;
  summaryLine: string;
};

const filterOptions = [
  { label: "All", value: "all" },
  { label: "To review", value: "to_review" },
  { label: "To call", value: "to_call" },
  { label: "In progress", value: "in_progress" },
  { label: "Archived", value: "archived" },
] satisfies Array<{ label: string; value: ReviewFilter }>;

export function InterviewOverviewTabs({
  candidates,
  criteria,
  guardrails,
  questions,
  roleBrief,
  summaryLine,
}: InterviewOverviewTabsProps) {
  const [tab, setTab] = React.useState<OverviewTab>("candidates");
  const [filter, setFilter] = React.useState<ReviewFilter>("all");
  const needsReviewCount = React.useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          candidate.reviewStatus === "to_review" &&
          !isCandidateScreenInProgress(candidate.status),
      ).length,
    [candidates],
  );
  const visibleCandidates = React.useMemo(
    () =>
      candidates.filter((candidate) => matchesFilter(candidate, filter)),
    [candidates, filter],
  );

  return (
    <section className="mt-6">
      <UnderlineTabs
        ariaLabel="Interview detail sections"
        onValueChange={setTab}
        options={[
          {
            count: needsReviewCount > 0 ? needsReviewCount : undefined,
            label: "Candidates",
            value: "candidates",
          },
          { label: "Interview setup", value: "setup" },
        ]}
        value={tab}
      />

      {tab === "candidates" ? (
        <CandidatesPanel
          candidates={candidates}
          filter={filter}
          onFilterChange={setFilter}
          summaryLine={summaryLine}
          visibleCandidates={visibleCandidates}
        />
      ) : (
        <SetupPanel
          criteria={criteria}
          guardrails={guardrails}
          questions={questions}
          roleBrief={roleBrief}
        />
      )}
    </section>
  );
}

function CandidatesPanel({
  candidates,
  filter,
  onFilterChange,
  summaryLine,
  visibleCandidates,
}: {
  candidates: CandidateScreenListItem[];
  filter: ReviewFilter;
  onFilterChange: (value: ReviewFilter) => void;
  summaryLine: string;
  visibleCandidates: CandidateScreenListItem[];
}) {
  return (
    <div className="mt-5">
      <p className="text-[13.5px] leading-6 text-ink-500">{summaryLine}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {filterOptions.map((option) => {
          const active = option.value === filter;
          const count = candidates.filter((candidate) =>
            matchesFilter(candidate, option.value),
          ).length;

          return (
            <button
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
                active
                  ? "border-[#e2e6d3] bg-[#eef0e3] text-olive-950"
                  : "border-ink-100 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-950",
              )}
              key={option.value}
              onClick={() => onFilterChange(option.value)}
              type="button"
            >
              {option.label}
              <span
                className={cn(
                  "text-[11.5px] font-bold",
                  active ? "text-olive-900" : "text-ink-400",
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
        emptyDescription="No session matches this filter yet."
        emptyTitle="No candidates here"
      />
    </div>
  );
}

function SetupPanel({
  criteria,
  guardrails,
  questions,
  roleBrief,
}: {
  criteria: InterviewOverviewCriterion[];
  guardrails: string[];
  questions: InterviewOverviewQuestion[];
  roleBrief: string;
}) {
  return (
    <div className="mt-6 space-y-8">
      <section>
        <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-ink-400">
          Role brief
        </p>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-7 text-ink-600">
          {roleBrief || "No role brief has been added yet."}
        </p>
      </section>

      <section>
        <SectionTitle
          description="What the live interviewer asks, and the signal each answer reveals."
          title="Interview script"
        />
        <div className="mt-4 space-y-2.5">
          {questions.map((question) => (
            <article
              className="flex gap-4 rounded-2xl border border-ink-100 bg-white px-[18px] py-4"
              key={question.id}
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#eef0e3] text-[11.5px] font-bold text-olive-900">
                {question.numberLabel}
              </span>
              <span className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-6 text-ink-950">
                  {question.prompt}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-5 text-ink-500">
                  <span className="font-semibold text-ink-600">Signal · </span>
                  {question.signal}
                  <span className="text-ink-300"> · </span>
                  {question.sourceLabel}
                </p>
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <SectionTitle
            description="What reviewers compare after the screen."
            title="Evaluation criteria"
          />
          <div className="mt-4 space-y-2">
            {criteria.map((criterion) => (
              <div
                className="rounded-2xl border border-ink-100 bg-white px-4 py-3"
                key={criterion.id}
              >
                <p className="text-[13.5px] font-semibold text-ink-950">
                  {criterion.label}
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-ink-500">
                  {criterion.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle
            description="Rules the interviewer must preserve."
            title="Guardrails"
          />
          <div className="mt-4 space-y-3">
            {guardrails.map((guardrail) => (
              <div className="flex gap-2.5" key={guardrail}>
                <CheckCircle
                  aria-hidden={true}
                  className="mt-0.5 h-4 w-4 shrink-0 text-olive-800"
                />
                <p className="text-[13px] leading-6 text-ink-600">
                  {guardrail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex gap-2.5 rounded-2xl border border-ink-100 bg-[#f7f7ef] px-4 py-3 text-sm leading-6 text-ink-600">
        <WarningTriangle
          aria-hidden={true}
          className="mt-0.5 h-4 w-4 shrink-0 text-olive-800"
        />
        <p>
          The interview supports human screening only. It must not be used as an
          automated hiring or rejection decision.
        </p>
      </div>
    </div>
  );
}

function SectionTitle({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink-950">
        {title}
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-500">{description}</p>
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
