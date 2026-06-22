"use client";

import Link from "next/link";
import { ArrowRight, UserBadgeCheck } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, cn } from "@prelude/ui";

import { CriteriaSignal } from "../dashboard/criteria-signal";
import {
  candidateReviewStatusTone,
  formatCandidateReviewStatus,
  formatCandidateScreenDate,
  formatCandidateScreenStatus,
  formatClarificationCount,
  formatQuestionCompletionLabel,
  initialsForCandidate,
} from "./candidate-screen-formatters";
import type { CandidateScreenListItem } from "./candidate-screen-types";

export function CandidateScreensTable({
  candidates,
  className,
  emptyDescription,
  emptyTitle,
}: {
  candidates: CandidateScreenListItem[];
  className?: string;
  emptyDescription?: string;
  emptyTitle?: string;
}) {
  const { t } = useTranslation();

  return (
    <section
      className={cn(
        "mt-4 overflow-hidden rounded-[24px] border border-ink-100 bg-white/74 backdrop-blur",
        className,
      )}
    >
      <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_132px_96px] gap-4 border-b border-ink-100 px-[22px] py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-400 md:grid">
        <span>{t("candidateScreens.columnCandidate")}</span>
        <span>{t("candidateScreens.columnCriteriaSignal")}</span>
        <span>{t("candidateScreens.columnCoverage")}</span>
        <span className="text-right">{t("candidateScreens.columnUpdated")}</span>
      </div>

      {candidates.length > 0 ? (
        <div className="divide-y divide-ink-100">
          {candidates.map((candidate) => (
            <CandidateScreenRow candidate={candidate} key={candidate.id} />
          ))}
        </div>
      ) : (
        <CandidateScreensEmptyState
          description={
            emptyDescription ?? t("candidateScreens.emptyDescriptionDefault")
          }
          title={emptyTitle ?? t("candidateScreens.emptyTitleDefault")}
        />
      )}
    </section>
  );
}

function CandidateScreenRow({
  candidate,
}: {
  candidate: CandidateScreenListItem;
}) {
  const { i18n, t } = useTranslation();

  return (
    <Link
      className="group grid cursor-pointer gap-4 px-[22px] py-4 transition hover:bg-white md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.05fr)_132px_96px] md:items-center md:gap-4"
      href={candidate.href}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#eef0e3] text-xs font-semibold text-olive-900">
          {initialsForCandidate(candidate.candidateLabel)}
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink-950">
              {candidate.candidateLabel}
            </span>
            <StatusBadge
              className="shrink-0 whitespace-nowrap"
              tone={candidateReviewStatusTone(candidate.reviewStatus)}
            >
              {formatCandidateReviewStatus(candidate.reviewStatus, t)}
            </StatusBadge>
          </span>
          <span className="mt-1 block truncate text-sm text-ink-500">
            {candidate.roleTitle} · {candidate.jobTitle}
          </span>
        </span>
      </span>

      <span className="min-w-0">
        <CriteriaSignal
          analysisStatus={candidate.analysisStatus}
          distribution={candidate.criteriaDistribution}
          hasCompletedBrief={candidate.hasCompletedBrief}
        />
      </span>

      <span>
        <span className="block text-sm font-medium text-ink-700">
          {formatQuestionCompletionLabel(candidate.questionCompletionRate, t)}
        </span>
        <span className="mt-1 block text-xs text-ink-400">
          {formatClarificationCount(candidate.pointsToClarifyCount, t)}
        </span>
      </span>

      <span className="flex items-center justify-between gap-3 md:justify-end">
        <span className="text-left md:text-right">
          <span className="block text-sm text-ink-500">
            {formatCandidateScreenDate(
              candidate.completedAt ?? candidate.startedAt,
              i18n.language,
              t("candidateScreens.dateNone"),
            )}
          </span>
          <span className="mt-1 block text-xs text-ink-400">
            {formatCandidateScreenStatus(candidate.status)}
          </span>
        </span>
        <ArrowRight
          aria-hidden={true}
          className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-900"
        />
      </span>
    </Link>
  );
}

function CandidateScreensEmptyState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
        <UserBadgeCheck aria-hidden={true} className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-semibold text-ink-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-ink-500">{description}</p>
    </div>
  );
}
