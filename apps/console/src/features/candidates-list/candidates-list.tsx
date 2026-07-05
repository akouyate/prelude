"use client";

import * as React from "react";
import { Search, Sort } from "iconoir-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { MetricCard, SegmentedTabs } from "@prelude/ui";

import {
  CandidateScreensTable,
  candidateReviewRank,
  candidateScreenMatchesQuery,
  type CandidateScreenListItem,
} from "../candidate-screens";

type CandidateFilter = "all" | "archived" | "to_call" | "to_review";
type CandidateSort = "name" | "recent" | "review";
export type { CandidateScreenListItem } from "../candidate-screens";

export function CandidatesList({
  candidates,
  organizationName,
}: {
  candidates: CandidateScreenListItem[];
  organizationName: string;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = React.useState<CandidateFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<CandidateSort>("recent");

  const counts = React.useMemo(() => getCounts(candidates), [candidates]);
  const rows = React.useMemo(() => {
    return [...candidates]
      .filter((candidate) =>
        filter === "all" ? true : candidate.reviewStatus === filter,
      )
      .filter((candidate) => candidateScreenMatchesQuery(candidate, query))
      .sort((left, right) => sortCandidates(left, right, sort));
  }, [candidates, filter, query, sort]);

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
          active={filter === "to_review"}
          label={t("candidates.summaryToReviewLabel")}
          meta={t("candidates.summaryToReviewSub")}
          onClick={() => setFilter("to_review")}
          value={String(counts.to_review)}
        />
        <MetricCard
          active={filter === "to_call"}
          label={t("candidates.summaryToCallLabel")}
          meta={t("candidates.summaryToCallSub")}
          onClick={() => setFilter("to_call")}
          value={String(counts.to_call)}
        />
        <MetricCard
          active={filter === "archived"}
          label={t("candidates.summaryArchivedLabel")}
          meta={t("candidates.summaryArchivedSub")}
          onClick={() => setFilter("archived")}
          value={String(counts.archived)}
        />
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel={t("candidates.filterAria")}
          onValueChange={setFilter}
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
          value={filter}
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-[38px] items-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3 text-ink-400 focus-within:border-ink-400 focus-within:bg-white">
            <Search aria-hidden={true} className="h-4 w-4 shrink-0" />
            <span className="sr-only">{t("candidates.searchAria")}</span>
            <input
              className="w-40 bg-transparent text-[13px] text-ink-950 outline-none placeholder:text-ink-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("candidates.searchPlaceholder")}
              value={query}
            />
          </label>
          <button
            className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3.5 text-[12.5px] font-semibold text-ink-700 transition hover:border-ink-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            onClick={() => setSort(nextSort(sort))}
            type="button"
          >
            <Sort aria-hidden={true} className="h-4 w-4" />
            {formatSort(sort, t)}
          </button>
        </div>
      </section>

      <CandidateScreensTable candidates={rows} />
    </div>
  );
}

function getCounts(candidates: CandidateScreenListItem[]) {
  return {
    all: candidates.length,
    archived: candidates.filter(
      (candidate) => candidate.reviewStatus === "archived",
    ).length,
    to_call: candidates.filter(
      (candidate) => candidate.reviewStatus === "to_call",
    ).length,
    to_review: candidates.filter(
      (candidate) => candidate.reviewStatus === "to_review",
    ).length,
  };
}

function sortCandidates(
  left: CandidateScreenListItem,
  right: CandidateScreenListItem,
  sort: CandidateSort,
) {
  if (sort === "name") {
    return left.candidateLabel.localeCompare(right.candidateLabel);
  }

  if (sort === "review") {
    return (
      candidateReviewRank(left.reviewStatus) -
      candidateReviewRank(right.reviewStatus)
    );
  }

  return (
    new Date(right.completedAt ?? right.startedAt ?? 0).getTime() -
    new Date(left.completedAt ?? left.startedAt ?? 0).getTime()
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
