"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, List, Phone, ShieldCheck, SortDown } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { MetricCard } from "@prelude/ui";

import {
  CandidateQueueTable,
  type CandidateQueueRow,
} from "../candidate-screens";

type ReviewQueueFilter = "all" | "archived" | "to_call" | "to_review";

export type DashboardReviewQueueRow = CandidateQueueRow;

export function DashboardReviewQueue({
  guardrailCopy,
  onStatusChange,
  rows,
  staleCount,
  staleAfterDays,
}: {
  guardrailCopy: string;
  onStatusChange: (formData: FormData) => Promise<void>;
  rows: DashboardReviewQueueRow[];
  staleAfterDays: number;
  staleCount: number;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = React.useState<ReviewQueueFilter>("to_review");
  const [oldestFirst, setOldestFirst] = React.useState(true);

  const counts = React.useMemo(
    () =>
      rows.reduce(
        (totals, row) => ({
          ...totals,
          all: totals.all + 1,
          [row.reviewStatus]: totals[row.reviewStatus] + 1,
        }),
        { all: 0, archived: 0, to_call: 0, to_review: 0 },
      ),
    [rows],
  );

  const visibleRows = React.useMemo(() => {
    const matching =
      filter === "all"
        ? [...rows]
        : rows.filter((row) => row.reviewStatus === filter);

    return matching.sort((a, b) =>
      oldestFirst
        ? b.waitingDays - a.waitingDays
        : a.waitingDays - b.waitingDays,
    );
  }, [filter, oldestFirst, rows]);

  return (
    <>
      <section
        aria-label={t("dashboard.reviewQueueFilterAria")}
        className="mt-[26px] grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricCard
          active={filter === "to_review"}
          className="rounded-[22px] p-5"
          icon={<ShieldCheck aria-hidden={true} className="h-4 w-4" />}
          label={t("dashboard.tileNeedsReviewLabel")}
          meta={
            staleCount > 0
              ? t("dashboard.tileNeedsReviewOverdue", {
                  count: staleCount,
                  days: staleAfterDays,
                })
              : t("dashboard.tileNeedsReviewClear")
          }
          onClick={() => setFilter("to_review")}
          variant="kpi"
          value={counts.to_review.toString()}
        />
        <MetricCard
          active={filter === "to_call"}
          className="rounded-[22px] p-5"
          icon={<Phone aria-hidden={true} className="h-4 w-4" />}
          label={t("dashboard.tileToCallLabel")}
          meta={t("dashboard.tileToCallMeta")}
          onClick={() => setFilter("to_call")}
          variant="kpi"
          value={counts.to_call.toString()}
        />
        <MetricCard
          active={filter === "archived"}
          className="rounded-[22px] p-5"
          icon={<Archive aria-hidden={true} className="h-4 w-4" />}
          label={t("dashboard.tileArchivedLabel")}
          meta={t("dashboard.tileArchivedMeta")}
          onClick={() => setFilter("archived")}
          variant="kpi"
          value={counts.archived.toString()}
        />
        <MetricCard
          active={filter === "all"}
          className="rounded-[22px] p-5"
          icon={<List aria-hidden={true} className="h-4 w-4" />}
          label={t("dashboard.tileAllLabel")}
          meta={t("dashboard.tileAllMeta")}
          onClick={() => setFilter("all")}
          variant="kpi"
          value={counts.all.toString()}
        />
      </section>

      <section
        className="mt-6 overflow-hidden rounded-[24px] border border-ink-100 bg-white/74 backdrop-blur"
        id="review-queue"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 px-[22px] pb-[18px] pt-[22px]">
          <div>
            <h2 className="text-lg font-semibold text-ink-950">
              {t(`dashboard.reviewQueueTitle.${filter}`)}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {t("dashboard.reviewQueueSubtitle", {
                count: visibleRows.length,
              })}
            </p>
          </div>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-full border border-ink-100 bg-white px-[13px] text-[12.5px] font-semibold text-ink-600 transition hover:border-ink-900 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            onClick={() => setOldestFirst((previous) => !previous)}
            type="button"
          >
            <SortDown aria-hidden={true} className="h-3.5 w-3.5" />
            {oldestFirst
              ? t("dashboard.reviewQueueSortOldest")
              : t("dashboard.reviewQueueSortNewest")}
          </button>
        </div>

        <CandidateQueueTable
          className="border-t border-ink-100"
          emptyNote={t(`dashboard.reviewQueueEmptyNote.${filter}`)}
          emptyTitle={t(`dashboard.reviewQueueEmptyTitle.${filter}`)}
          onStatusChange={onStatusChange}
          rows={visibleRows}
        />

        <p className="flex gap-2 border-t border-ink-100 bg-[#f7f7ef] px-[22px] py-3.5 text-xs leading-[1.5] text-ink-500">
          <ShieldCheck
            aria-hidden={true}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400"
          />
          <span>
            {guardrailCopy}{" "}
            <Link
              className="text-ink-600 underline underline-offset-2"
              href="/settings"
            >
              {t("dashboard.reviewPolicyLink")}
            </Link>
          </span>
        </p>
      </section>
    </>
  );
}
