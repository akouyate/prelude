"use client";

import * as React from "react";
import { Search, Sort } from "iconoir-react";
import { SegmentedTabs, cn } from "@prelude/ui";

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
            {organizationName} · Candidate screens
          </p>
          <h1 className="mt-1.5 text-[clamp(28px,3.4vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
            Your{" "}
            <span className="font-serif italic font-normal">candidates</span>
          </h1>
          <p className="mt-2.5 max-w-[42rem] text-[15px] leading-[1.55] text-ink-600">
            Each row is a candidate screen: one candidate answer session,
            attached to a role and ready for human review.
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          active={filter === "to_review"}
          label="To review"
          onClick={() => setFilter("to_review")}
          sub="Needs recruiter decision"
          value={String(counts.to_review)}
        />
        <SummaryCard
          active={filter === "to_call"}
          label="To call"
          onClick={() => setFilter("to_call")}
          sub="Ready for follow-up"
          value={String(counts.to_call)}
        />
        <SummaryCard
          active={filter === "archived"}
          label="Archived"
          onClick={() => setFilter("archived")}
          sub="No active next step"
          value={String(counts.archived)}
        />
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel="Candidate screen review filter"
          onValueChange={setFilter}
          options={[
            { label: `All ${counts.all}`, value: "all" },
            { label: `To review ${counts.to_review}`, value: "to_review" },
            { label: `To call ${counts.to_call}`, value: "to_call" },
            { label: `Archived ${counts.archived}`, value: "archived" },
          ]}
          value={filter}
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-[38px] items-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3 text-ink-400 focus-within:border-ink-400 focus-within:bg-white">
            <Search aria-hidden={true} className="h-4 w-4 shrink-0" />
            <span className="sr-only">Search candidates</span>
            <input
              className="w-40 bg-transparent text-[13px] text-ink-950 outline-none placeholder:text-ink-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search candidates"
              value={query}
            />
          </label>
          <button
            className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3.5 text-[12.5px] font-semibold text-ink-700 transition hover:border-ink-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            onClick={() => setSort(nextSort(sort))}
            type="button"
          >
            <Sort aria-hidden={true} className="h-4 w-4" />
            {formatSort(sort)}
          </button>
        </div>
      </section>

      <CandidateScreensTable candidates={rows} />
    </div>
  );
}

function SummaryCard({
  active,
  label,
  onClick,
  sub,
  value,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  sub: string;
  value: string;
}) {
  return (
    <button
      className={cn(
        "cursor-pointer rounded-[20px] border p-[17px] text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
        active
          ? "border-[#e2e6d3] bg-[#eef0e3]"
          : "border-ink-100 bg-white/72 hover:bg-white",
      )}
      onClick={onClick}
      type="button"
    >
      <p className="text-[12.5px] font-semibold text-ink-700">{label}</p>
      <p className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.03em] text-ink-950">
        {value}
      </p>
      <p className="mt-2 text-xs text-ink-500">{sub}</p>
    </button>
  );
}

function getCounts(candidates: CandidateScreenListItem[]) {
  return {
    all: candidates.length,
    archived: candidates.filter((candidate) => candidate.reviewStatus === "archived")
      .length,
    to_call: candidates.filter((candidate) => candidate.reviewStatus === "to_call")
      .length,
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

function formatSort(sort: CandidateSort) {
  if (sort === "review") {
    return "Review status";
  }

  if (sort === "name") {
    return "A-Z";
  }

  return "Recent";
}
