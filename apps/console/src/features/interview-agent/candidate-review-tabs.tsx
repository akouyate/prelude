"use client";

import type { LiveInterviewRecruiterSummary } from "@prelude/contracts";
import { StatusBadge } from "@prelude/ui";
import {
  ClipboardCheck,
  MessageText,
  ShieldCheck,
  Sparks,
  WarningTriangle,
} from "iconoir-react";
import * as React from "react";

type CandidateReviewTabsProps = {
  summary: LiveInterviewRecruiterSummary;
};

type TabId = "overview" | "questions" | "follow_up" | "evidence";

const tabs: Array<{
  id: TabId;
  label: string;
  description: string;
}> = [
  {
    id: "overview",
    label: "Summary",
    description: "Decision signals",
  },
  {
    id: "questions",
    label: "Answers",
    description: "Question review",
  },
  {
    id: "follow_up",
    label: "Follow-ups",
    description: "Clarify next",
  },
  {
    id: "evidence",
    label: "Evidence",
    description: "Quotes and audit",
  },
];

export function CandidateReviewTabs({ summary }: CandidateReviewTabsProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>("overview");

  return (
    <section className="rounded-3xl border border-ink-100 bg-white/76 backdrop-blur">
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-olive-900">
              Review workspace
            </p>
            <p className="mt-1 text-sm text-ink-500">
              Switch between the recruiter summary, answers, next steps, and evidence.
            </p>
          </div>
        </div>
        <div className="mt-6 border-b border-ink-100">
          <div
            aria-label="Candidate recap sections"
            className="grid grid-cols-4 gap-0 sm:flex sm:gap-7"
            role="tablist"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  aria-selected={isActive}
                  className="-mb-px cursor-pointer border-b-[3px] border-transparent pb-3 text-left transition hover:text-ink-950 aria-selected:border-ink-950 sm:min-w-max"
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span
                    className={`block text-sm font-semibold sm:text-base ${
                      isActive ? "text-ink-950" : "text-ink-500"
                    }`}
                  >
                    {tab.label}
                  </span>
                  <span className="mt-1 hidden text-xs font-medium text-ink-400 sm:block">
                    {tab.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-5">
        {activeTab === "overview" ? <OverviewTab summary={summary} /> : null}
        {activeTab === "questions" ? (
          <QuestionTab questions={summary.questionNotes} />
        ) : null}
        {activeTab === "follow_up" ? (
          <FollowUpTab
            followUpQuestions={summary.followUpQuestions}
            logisticsNotes={summary.logisticsNotes}
            missingInformation={summary.missingInformation}
          />
        ) : null}
        {activeTab === "evidence" ? <EvidenceTab summary={summary} /> : null}
      </div>
    </section>
  );
}

function OverviewTab({ summary }: { summary: LiveInterviewRecruiterSummary }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-ink-100 bg-white/54">
        {summary.criteria.map((criterion) => (
          <div
            key={criterion.criterionId}
            className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-ink-950">
                  {criterion.label}
                </p>
                <StatusBadge tone={statusTone(criterion.status)}>
                  {formatStatus(criterion.status)}
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                {criterion.note}
              </p>
            </div>
            <span className="text-sm font-medium text-ink-500">
              {criterion.evidence.length} proof
              {criterion.evidence.length > 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 content-start">
        <CompactSignal
          label="Best signal"
          tone="success"
          value={summary.strengths[0]?.title ?? "No strength extracted"}
        />
        <CompactSignal
          label="Main risk"
          tone="warning"
          value={summary.risks[0]?.title ?? "No major risk detected"}
        />
        <CompactSignal
          label="Missing"
          tone="muted"
          value={
            summary.missingInformation[0] ??
            "No missing information flagged"
          }
        />
      </div>
    </div>
  );
}

function CompactSignal({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "muted" | "success" | "warning";
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/62 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        <StatusBadge tone={tone}>1</StatusBadge>
      </div>
      <p className="mt-2 text-sm font-medium leading-6 text-ink-950">{value}</p>
    </div>
  );
}

function QuestionTab({
  questions,
}: {
  questions: LiveInterviewRecruiterSummary["questionNotes"];
}) {
  return (
    <div className="space-y-3">
      {questions.map((note, index) => (
        <article
          key={note.questionId}
          className="rounded-3xl border border-ink-100 bg-white/62 p-4"
        >
          <div className="flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#eef0e3] text-sm font-semibold text-olive-800">
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={statusTone(note.answerStatus)}>
                  {formatStatus(note.answerStatus)}
                </StatusBadge>
                <span className="text-sm text-ink-500">
                  {formatStatus(note.category)}
                </span>
              </div>
              <h3 className="mt-2 text-base font-semibold leading-6 text-ink-950">
                {note.prompt}
              </h3>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                {note.answerSummary}
              </p>
              <EvidenceQuotes evidence={note.evidence} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function FollowUpTab({
  followUpQuestions,
  logisticsNotes,
  missingInformation,
}: {
  followUpQuestions: string[];
  logisticsNotes: string[];
  missingInformation: string[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <FollowUpColumn
        icon={<WarningTriangle aria-hidden="true" className="h-4 w-4" />}
        title="Clarify first"
        values={missingInformation}
      />
      <FollowUpColumn
        icon={<Sparks aria-hidden="true" className="h-4 w-4" />}
        title="Suggested questions"
        values={followUpQuestions}
      />
      <FollowUpColumn
        icon={<ClipboardCheck aria-hidden="true" className="h-4 w-4" />}
        title="Logistics"
        values={logisticsNotes}
      />
    </div>
  );
}

function FollowUpColumn({
  icon,
  title,
  values,
}: {
  icon: React.ReactNode;
  title: string;
  values: string[];
}) {
  return (
    <div className="rounded-3xl border border-ink-100 bg-white/62 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
        {icon}
        {title}
      </div>
      {values.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {values.map((value) => (
            <li key={value} className="text-sm leading-6 text-ink-600">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm leading-6 text-ink-500">
          Nothing flagged yet.
        </p>
      )}
    </div>
  );
}

function EvidenceTab({ summary }: { summary: LiveInterviewRecruiterSummary }) {
  const signals = [...summary.strengths, ...summary.risks];

  return (
    <div className="space-y-4">
      {signals.map((signal) => (
        <article
          key={`${signal.title}-${signal.confidence}`}
          className="rounded-3xl border border-ink-100 bg-white/62 p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <MessageText aria-hidden="true" className="h-4 w-4 text-ink-500" />
            <h3 className="font-semibold text-ink-950">{signal.title}</h3>
            <StatusBadge tone="neutral">
              {signal.confidence} confidence
            </StatusBadge>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            {signal.explanation}
          </p>
          <EvidenceQuotes evidence={signal.evidence} />
        </article>
      ))}

      <details className="group rounded-3xl border border-ink-100 bg-white/62 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink-950">
          <span className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Audit and guardrails
          </span>
          <span className="text-ink-400 group-open:hidden">Open</span>
          <span className="hidden text-ink-400 group-open:inline">Close</span>
        </summary>
        <div className="mt-4 space-y-3 text-sm leading-6 text-ink-600">
          <p>{summary.disclaimer}</p>
          <p>
            Generated from {summary.audit.sourceEventIds.length} events and{" "}
            {summary.audit.transcriptTurnIds.length} transcript turns.
          </p>
          {summary.excludedSensitiveSignals.length > 0 ? (
            <p>Excluded: {summary.excludedSensitiveSignals.join(", ")}.</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function EvidenceQuotes({
  evidence,
}: {
  evidence: LiveInterviewRecruiterSummary["criteria"][number]["evidence"];
}) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {evidence.slice(0, 2).map((item) => (
        <blockquote
          key={`${item.eventId}-${item.turnId ?? item.quote}`}
          className="border-l-2 border-ink-200 pl-3 text-sm leading-6 text-ink-700"
        >
          {item.quote}
        </blockquote>
      ))}
    </div>
  );
}

function statusTone(status: string) {
  if (status === "satisfied") {
    return "success";
  }

  if (status === "unclear") {
    return "warning";
  }

  if (status === "missing") {
    return "danger";
  }

  return "muted";
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}
