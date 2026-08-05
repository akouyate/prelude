"use client";

import * as React from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { ArrowRight, CheckCircle } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, cn } from "@prelude/ui";

import { candidateReviewStaleAfterDays } from "../../domain/candidate-review-policy";
import { CriteriaSignal } from "../dashboard/criteria-signal";
import {
  candidateReviewStatusTone,
  formatCandidateReviewStatus,
  formatCandidateScreenStatus,
  formatClarificationCount,
  formatQuestionCompletionLabel,
  initialsForCandidate,
} from "./candidate-screen-formatters";
import type {
  CandidateReviewStatus,
  CandidateScreenListItem,
} from "./candidate-screen-types";

export type CandidateQueueRow = CandidateScreenListItem & {
  // Precomputed on the server so the table never derives "now" during render.
  waitingDays: number;
};

const gridTemplate =
  "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_118px_104px_178px]";

export function CandidateQueueTable({
  className,
  emptyNote,
  emptyTitle,
  onStatusChange,
  rows,
}: {
  className?: string;
  emptyNote: string;
  emptyTitle: string;
  onStatusChange: (formData: FormData) => Promise<void>;
  rows: CandidateQueueRow[];
}) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <div
        className={cn(
          "hidden gap-4 border-b border-ink-100 px-[22px] py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-400 lg:grid",
          gridTemplate,
        )}
      >
        <span>{t("candidateScreens.columnCandidate")}</span>
        <span>{t("candidateScreens.columnCriteriaSignal")}</span>
        <span>{t("candidateScreens.columnCoverage")}</span>
        <span>{t("dashboard.columnWaiting")}</span>
        <span className="text-right">{t("dashboard.columnActions")}</span>
      </div>

      {rows.map((row) => (
        <CandidateQueueRowView
          key={row.id}
          onStatusChange={onStatusChange}
          row={row}
        />
      ))}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 px-[22px] py-14 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
            <CheckCircle aria-hidden={true} className="h-5 w-5" />
          </span>
          <p className="text-[15px] font-semibold text-ink-950">{emptyTitle}</p>
          <p className="max-w-[26rem] text-sm leading-[1.55] text-ink-500">
            {emptyNote}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CandidateQueueRowView({
  onStatusChange,
  row,
}: {
  onStatusChange: (formData: FormData) => Promise<void>;
  row: CandidateQueueRow;
}) {
  const { t } = useTranslation();
  const isStale =
    row.reviewStatus === "to_review" &&
    row.waitingDays >= candidateReviewStaleAfterDays;

  return (
    <div
      className={cn(
        "grid items-center gap-y-3 border-b border-ink-100 px-[22px] py-4 transition last:border-b-0 hover:bg-white lg:gap-4",
        gridTemplate,
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-xs font-semibold text-olive-900">
          {initialsForCandidate(row.candidateLabel)}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              className="truncate text-sm font-semibold text-ink-950 transition hover:text-olive-900"
              href={row.href}
            >
              {row.candidateLabel}
            </Link>
            <StatusBadge
              className="shrink-0 whitespace-nowrap"
              tone={candidateReviewStatusTone(row.reviewStatus)}
            >
              {formatCandidateReviewStatus(row.reviewStatus, t)}
            </StatusBadge>
          </span>
          <span className="mt-1 block truncate text-sm text-ink-500">
            {row.roleTitle} · {row.jobTitle}
          </span>
        </span>
      </span>

      <span className="min-w-0 max-lg:max-w-sm">
        <CriteriaSignal
          analysisStatus={row.analysisStatus}
          distribution={row.criteriaDistribution}
          hasCompletedBrief={row.hasCompletedBrief}
        />
      </span>

      <span className="flex items-baseline gap-3 max-lg:flex-wrap lg:block">
        <span className="block text-sm font-medium text-ink-700">
          {formatQuestionCompletionLabel(row.questionCompletionRate, t)}
        </span>
        <span className="block text-xs text-ink-400 lg:mt-1">
          {formatClarificationCount(row.pointsToClarifyCount, t)}
        </span>
      </span>

      <span className="flex items-baseline gap-3 max-lg:flex-wrap lg:block">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-medium tabular-nums",
            isStale ? "text-[#a3421f]" : "text-ink-700",
          )}
        >
          {isStale ? (
            <span className="block h-1.5 w-1.5 shrink-0 rounded-full bg-[#c2542f]" />
          ) : null}
          {row.waitingDays <= 0
            ? t("dashboard.waitingToday")
            : t("dashboard.waitingDays", { count: row.waitingDays })}
        </span>
        <span className="block text-xs capitalize text-ink-400 lg:mt-1">
          {formatCandidateScreenStatus(row.status)}
        </span>
      </span>

      <span className="flex items-center gap-2 max-lg:justify-start lg:justify-end">
        <form action={onStatusChange} className="flex items-center gap-2">
          <input name="candidateSessionId" type="hidden" value={row.id} />
          {row.reviewStatus === "to_review" ? (
            <>
              <QueueActionButton tone="solid" value="to_call">
                {t("candidateScreens.reviewToCall")}
              </QueueActionButton>
              <QueueActionButton tone="ghost" value="archived">
                {t("dashboard.queueActionArchive")}
              </QueueActionButton>
            </>
          ) : null}
          {row.reviewStatus === "to_call" ? (
            <QueueActionButton tone="ghost" value="archived">
              {t("dashboard.queueActionArchive")}
            </QueueActionButton>
          ) : null}
          {row.reviewStatus === "archived" ? (
            <QueueActionButton tone="ghost" value="to_review">
              {t("dashboard.queueActionReopen")}
            </QueueActionButton>
          ) : null}
        </form>
        <Link
          aria-label={t("dashboard.openCandidate")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-[#f1efe6] hover:text-ink-950"
          href={row.href}
        >
          <ArrowRight aria-hidden={true} className="h-4 w-4" />
        </Link>
      </span>
    </div>
  );
}

function QueueActionButton({
  children,
  tone,
  value,
}: {
  children: React.ReactNode;
  tone: "ghost" | "solid";
  value: CandidateReviewStatus;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={cn(
        "inline-flex h-8 items-center whitespace-nowrap rounded-full border px-[13px] text-[12.5px] font-semibold transition hover:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:opacity-50",
        tone === "solid"
          ? "border-ink-900 bg-ink-900 text-white hover:bg-ink-800"
          : "border-ink-200 bg-white text-ink-700",
      )}
      disabled={pending}
      name="reviewStatus"
      type="submit"
      value={value}
    >
      {children}
    </button>
  );
}
