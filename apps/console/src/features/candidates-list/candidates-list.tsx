"use client";

import * as React from "react";
import { Search, Sort } from "iconoir-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { MetricCard, SegmentedTabs } from "@prelude/ui";

import {
  CandidateScreensTable,
  type CandidateScreenListItem,
} from "../candidate-screens";
import { CursorPagination } from "../console-list/cursor-pagination";
import {
  type CandidateFilter,
  type CandidateSort,
  useCandidateListQueryState,
} from "../console-list/list-query-state";

export type { CandidateScreenListItem } from "../candidate-screens";

export function CandidatesList({
  candidates,
  counts,
  nextCursor,
  organizationName,
  previousCursor,
}: {
  candidates: CandidateScreenListItem[];
  counts: Record<CandidateFilter, number>;
  nextCursor: string | null;
  organizationName: string;
  previousCursor: string | null;
}) {
  const { t } = useTranslation();
  const [listQuery, setListQuery] = useCandidateListQueryState();
  const [queryDraft, setQueryDraft] = React.useState(listQuery.q);

  React.useEffect(() => {
    setQueryDraft(listQuery.q);
  }, [listQuery.q]);

  React.useEffect(() => {
    if (queryDraft === listQuery.q) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void setListQuery({ cursor: null, q: queryDraft });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [listQuery.q, queryDraft, setListQuery]);

  const setFilter = React.useCallback(
    (filter: CandidateFilter) => void setListQuery({ cursor: null, filter }),
    [setListQuery],
  );

  const setSort = React.useCallback(
    (sort: CandidateSort) => void setListQuery({ cursor: null, sort }),
    [setListQuery],
  );

  return (
    <div>
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-500">
            {t("candidates.headerEyebrow", { organizationName })}
          </p>
          <h1 className="mt-1.5 text-[clamp(28px,3.4vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
            {t("candidates.titlePrefix")}{" "}
            <span className="font-serif italic font-normal">
              {t("candidates.titleEmphasis")}
            </span>
          </h1>
          <p className="mt-2.5 max-w-[42rem] text-[15px] leading-[1.55] text-ink-600">
            {t("candidates.subtitle")}
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <MetricCard
          active={listQuery.filter === "to_review"}
          label={t("candidates.summaryToReviewLabel")}
          meta={t("candidates.summaryToReviewSub")}
          onClick={() => setFilter("to_review")}
          value={String(counts.to_review)}
        />
        <MetricCard
          active={listQuery.filter === "to_call"}
          label={t("candidates.summaryToCallLabel")}
          meta={t("candidates.summaryToCallSub")}
          onClick={() => setFilter("to_call")}
          value={String(counts.to_call)}
        />
        <MetricCard
          active={listQuery.filter === "archived"}
          label={t("candidates.summaryArchivedLabel")}
          meta={t("candidates.summaryArchivedSub")}
          onClick={() => setFilter("archived")}
          value={String(counts.archived)}
        />
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel={t("candidates.filterAria")}
          onValueChange={(value) => setFilter(value as CandidateFilter)}
          options={[
            {
              label: t("candidates.tabAll", { count: counts.all }),
              value: "all",
            },
            {
              label: t("candidates.tabToReview", { count: counts.to_review }),
              value: "to_review",
            },
            {
              label: t("candidates.tabToCall", { count: counts.to_call }),
              value: "to_call",
            },
            {
              label: t("candidates.tabArchived", { count: counts.archived }),
              value: "archived",
            },
          ]}
          value={listQuery.filter}
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-[38px] items-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3 text-ink-400 focus-within:border-ink-400 focus-within:bg-white">
            <Search aria-hidden={true} className="h-4 w-4 shrink-0" />
            <span className="sr-only">{t("candidates.searchAria")}</span>
            <input
              className="w-40 bg-transparent text-[13px] text-ink-950 outline-none placeholder:text-ink-400"
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder={t("candidates.searchPlaceholder")}
              value={queryDraft}
            />
          </label>
          <button
            className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3.5 text-[12.5px] font-semibold text-ink-700 transition hover:border-ink-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            onClick={() => setSort(nextSort(listQuery.sort))}
            type="button"
          >
            <Sort aria-hidden={true} className="h-4 w-4" />
            {formatSort(listQuery.sort, t)}
          </button>
        </div>
      </section>

      <CandidateScreensTable candidates={candidates} />
      <CursorPagination
        nextCursor={nextCursor}
        previousCursor={previousCursor}
      />
    </div>
  );
}

function nextSort(sort: CandidateSort): CandidateSort {
  if (sort === "recent") {
    return "review";
  }

  if (sort === "review") {
    return "name";
  }

  return "recent";
}

function formatSort(sort: CandidateSort, t: TFunction) {
  if (sort === "review") {
    return t("candidates.sortReviewStatus");
  }

  if (sort === "name") {
    return t("candidates.sortAlpha");
  }

  return t("candidates.sortRecent");
}
