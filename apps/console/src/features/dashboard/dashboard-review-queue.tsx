"use client";

import * as React from "react";
import { ShieldCheck } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { SegmentedTabs } from "@prelude/ui";

import {
  CandidateScreensTable,
  type CandidateScreenListItem,
} from "../candidate-screens";

type ReviewQueueFilter = "all" | "archived" | "to_call" | "to_review";
export type ReviewQueueStatus = Exclude<ReviewQueueFilter, "all">;
export type DashboardReviewQueueRow = CandidateScreenListItem;

export function DashboardReviewQueue({
  guardrailCopy,
  rows,
}: {
  guardrailCopy: string;
  rows: DashboardReviewQueueRow[];
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = React.useState<ReviewQueueFilter>("all");
  const visibleRows = React.useMemo(() => {
    if (filter === "all") {
      return rows;
    }

    return rows.filter((row) => row.reviewStatus === filter);
  }, [filter, rows]);

  const reviewQueueFilters = React.useMemo(
    () =>
      [
        { label: t("dashboard.reviewQueueFilterAll"), value: "all" },
        { label: t("dashboard.reviewQueueFilterToReview"), value: "to_review" },
        { label: t("dashboard.reviewQueueFilterToCall"), value: "to_call" },
        { label: t("dashboard.reviewQueueFilterArchived"), value: "archived" },
      ] satisfies Array<{ label: string; value: ReviewQueueFilter }>,
    [t],
  );

  return (
    <section
      className="overflow-hidden rounded-[24px] border border-ink-100 bg-white/74 backdrop-blur"
      id="review-queue"
    >
      <div className="px-[22px] pb-4 pt-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-normal text-ink-950">
              {t("dashboard.reviewQueueTitle")}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {t("dashboard.reviewQueueSubtitle")}
            </p>
          </div>
          <SegmentedTabs
            ariaLabel={t("dashboard.reviewQueueFilterAria")}
            onValueChange={setFilter}
            options={reviewQueueFilters}
            value={filter}
          />
        </div>

        <div className="mt-4 flex gap-2.5 rounded-2xl border border-ink-100 bg-[#f7f7ef] px-3.5 py-3 text-sm leading-6 text-ink-600">
          <ShieldCheck
            aria-hidden={true}
            className="mt-0.5 h-4 w-4 shrink-0 text-olive-800"
          />
          <p>{guardrailCopy}</p>
        </div>
      </div>

      <CandidateScreensTable
        candidates={visibleRows}
        className="mt-2 rounded-none border-x-0 border-b-0 bg-transparent"
        emptyDescription={t("dashboard.reviewQueueEmptyDescription")}
        emptyTitle={t("dashboard.reviewQueueEmptyTitle")}
      />
    </section>
  );
}
