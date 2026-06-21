"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle,
  Copy,
  EditPencil,
  Microphone,
  Plus,
  Search,
  Sort,
} from "iconoir-react";
import { SegmentedTabs, StatusBadge, cn } from "@prelude/ui";

export type RoleScreenState =
  | "candidate_started"
  | "completed"
  | "draft"
  | "needs_review"
  | "published";

export type RoleListItem = {
  candidateCount: number;
  candidatePath: string | null;
  href: string;
  id: string;
  location: string | null;
  sourceProvider: string | null;
  state: RoleScreenState;
  title: string;
  updatedAt: string;
};

type RoleFilter = "all" | "completed" | "draft" | "live" | "needs_review";
type RoleSort = "alpha" | "candidates" | "recent";

export function RolesList({
  organizationName,
  roles,
}: {
  organizationName: string;
  roles: RoleListItem[];
}) {
  const [filter, setFilter] = React.useState<RoleFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<RoleSort>("recent");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const counts = React.useMemo(() => getCounts(roles), [roles]);
  const rows = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return [...roles]
      .filter((role) => matchesFilter(role, filter))
      .filter((role) => {
        if (!normalizedQuery) {
          return true;
        }

        return [role.title, role.location ?? "", formatProvider(role.sourceProvider)]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => sortRoles(left, right, sort));
  }, [filter, query, roles, sort]);

  const handleCopy = React.useCallback(async (role: RoleListItem) => {
    if (!role.candidatePath) {
      return;
    }

    const origin = typeof window === "undefined" ? "" : window.location.origin;
    await navigator.clipboard?.writeText(`${origin}${role.candidatePath}`);
    setCopiedId(role.id);
    window.setTimeout(() => setCopiedId(null), 1600);
  }, []);

  return (
    <div>
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-500">
            {organizationName} · Hiring
          </p>
          <h1 className="mt-1.5 text-[clamp(28px,3.4vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
            Your <span className="font-serif italic font-normal">roles</span>
          </h1>
          <p className="mt-2.5 max-w-[42rem] text-[15px] leading-[1.55] text-ink-600">
            Each role owns one screening setup: questions, criteria, response
            modes, guardrails, and the candidate link.
          </p>
        </div>

        <Link
          className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-[17px] text-[13px] font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          href="/interviews/new"
        >
          <Plus aria-hidden={true} className="h-4 w-4" />
          New role screen
        </Link>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryButton
          active={filter === "needs_review"}
          icon={<CheckCircle aria-hidden={true} className="h-4 w-4" />}
          label="Needs review"
          onClick={() => setFilter("needs_review")}
          sub="Candidate screens waiting"
          value={String(counts.needs_review)}
        />
        <SummaryButton
          active={filter === "live"}
          icon={<Microphone aria-hidden={true} className="h-4 w-4" />}
          label="Live role screens"
          onClick={() => setFilter("live")}
          sub="Published & collecting"
          value={String(counts.live)}
        />
        <SummaryButton
          active={filter === "draft"}
          icon={<EditPencil aria-hidden={true} className="h-4 w-4" />}
          label="Draft setups"
          onClick={() => setFilter("draft")}
          sub="Not published yet"
          value={String(counts.draft)}
        />
        <SummaryButton
          active={filter === "completed"}
          icon={<CheckCircle aria-hidden={true} className="h-4 w-4" />}
          label="Completed"
          onClick={() => setFilter("completed")}
          sub="Screening wrapped"
          value={String(counts.completed)}
        />
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel="Role status filter"
          onValueChange={setFilter}
          options={[
            { label: `All ${counts.all}`, value: "all" },
            { label: `Live ${counts.live}`, value: "live" },
            {
              label: `Needs review ${counts.needs_review}`,
              value: "needs_review",
            },
            { label: `Drafts ${counts.draft}`, value: "draft" },
            { label: `Completed ${counts.completed}`, value: "completed" },
          ]}
          value={filter}
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-[38px] items-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3 text-ink-400 focus-within:border-ink-400 focus-within:bg-white">
            <Search aria-hidden={true} className="h-4 w-4 shrink-0" />
            <span className="sr-only">Search roles</span>
            <input
              className="w-36 bg-transparent text-[13px] text-ink-950 outline-none placeholder:text-ink-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roles"
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

      <section className="mt-4 overflow-hidden rounded-[24px] border border-ink-100 bg-white/74 backdrop-blur">
        <div className="hidden grid-cols-[minmax(0,1.55fr)_150px_minmax(0,1fr)_150px] gap-4 border-b border-ink-100 px-[22px] py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-400 md:grid">
          <span>Role</span>
          <span>Setup</span>
          <span>Candidate screens</span>
          <span className="text-right">Updated</span>
        </div>

        {rows.length > 0 ? (
          <div className="divide-y divide-ink-100">
            {rows.map((role) => (
              <RoleRow
                copied={copiedId === role.id}
                key={role.id}
                onCopy={() => handleCopy(role)}
                role={role}
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
              <Microphone aria-hidden={true} className="h-5 w-5" />
            </span>
            <p className="mt-4 text-sm font-semibold text-ink-950">
              No roles here
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-500">
              Try another filter or clear your search.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryButton({
  active,
  icon,
  label,
  onClick,
  sub,
  value,
}: {
  active: boolean;
  icon: React.ReactNode;
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
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "text-[12.5px] font-semibold",
            active ? "text-olive-950" : "text-ink-700",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "grid h-[26px] w-[26px] place-items-center rounded-full",
            active
              ? "bg-white/60 text-olive-900"
              : "bg-[#f4f2ea] text-ink-600",
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.03em] text-ink-950">
        {value}
      </p>
      <p className="mt-2 text-xs text-ink-500">{sub}</p>
    </button>
  );
}

function RoleRow({
  copied,
  onCopy,
  role,
}: {
  copied: boolean;
  onCopy: () => void;
  role: RoleListItem;
}) {
  const source = sourceMeta(role.sourceProvider);
  const candidateLine =
    role.candidateCount === 0
      ? "No candidate screens yet"
      : `${role.candidateCount} candidate screen${
          role.candidateCount > 1 ? "s" : ""
        }`;

  return (
    <div
      className={cn(
        "grid gap-4 px-[22px] py-4 transition hover:bg-white md:grid-cols-[minmax(0,1.55fr)_150px_minmax(0,1fr)_150px] md:items-center md:gap-4",
        role.state === "needs_review" && "bg-[#fffaf7]/70",
      )}
    >
      <Link
        className="group flex min-w-0 cursor-pointer items-center gap-3"
        href={role.href}
      >
        <span
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl text-[12.5px] font-bold"
          style={{ background: source.bg, color: source.fg }}
        >
          {source.mono}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-semibold text-ink-950 group-hover:text-olive-950">
            {role.title}
          </span>
          <span className="mt-1 block truncate text-[12.5px] text-ink-500">
            {role.location ?? "Location not set"} · {source.name}
          </span>
        </span>
      </Link>

      <span>
        <StatusBadge tone={statusTone(role.state)}>
          {formatState(role.state)}
        </StatusBadge>
      </span>

      <span>
        <span className="block text-[13.5px] font-semibold text-ink-700">
          {candidateLine}
        </span>
        <span className="mt-1 block text-[11.5px] text-ink-400">
          {candidateHint(role)}
        </span>
      </span>

      <span className="flex items-center justify-between gap-3 md:justify-end">
        <span className="text-[12.5px] text-ink-500">
          {formatRelativeDate(role.updatedAt)}
        </span>
        <span className="flex items-center gap-1.5">
          {role.candidatePath ? (
            <button
              aria-label={copied ? "Candidate link copied" : "Copy candidate link"}
              className={cn(
                "grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[10px] border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
                copied
                  ? "border-[#cdd9b6] bg-[#eef0e3] text-olive-900"
                  : "border-ink-100 bg-white text-ink-600 hover:border-ink-900 hover:text-ink-950",
              )}
              onClick={onCopy}
              type="button"
            >
              <Copy aria-hidden={true} className="h-4 w-4" />
            </button>
          ) : null}
          <Link
            aria-label="Open role"
            className="grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-[10px] border border-ink-100 bg-white text-ink-600 transition hover:border-ink-900 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            href={role.href}
          >
            <EditPencil aria-hidden={true} className="h-4 w-4" />
          </Link>
        </span>
      </span>
    </div>
  );
}

function getCounts(roles: RoleListItem[]) {
  return {
    all: roles.length,
    completed: roles.filter((role) => groupFor(role) === "completed").length,
    draft: roles.filter((role) => groupFor(role) === "draft").length,
    live: roles.filter((role) => groupFor(role) === "live").length,
    needs_review: roles.filter((role) => role.state === "needs_review").length,
  };
}

function matchesFilter(role: RoleListItem, filter: RoleFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "needs_review") {
    return role.state === "needs_review";
  }

  return groupFor(role) === filter;
}

function groupFor(role: RoleListItem): Exclude<RoleFilter, "all"> {
  if (role.state === "draft") {
    return "draft";
  }

  if (role.state === "completed") {
    return "completed";
  }

  return "live";
}

function sortRoles(left: RoleListItem, right: RoleListItem, sort: RoleSort) {
  if (sort === "candidates") {
    return right.candidateCount - left.candidateCount;
  }

  if (sort === "alpha") {
    return left.title.localeCompare(right.title);
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function nextSort(sort: RoleSort): RoleSort {
  if (sort === "recent") {
    return "candidates";
  }

  if (sort === "candidates") {
    return "alpha";
  }

  return "recent";
}

function formatSort(sort: RoleSort) {
  if (sort === "candidates") {
    return "Most screens";
  }

  if (sort === "alpha") {
    return "A-Z";
  }

  return "Recent";
}

function sourceMeta(provider: string | null) {
  if (provider === "linkedin") {
    return { bg: "#0a66c2", fg: "#ffffff", mono: "in", name: "LinkedIn" };
  }

  if (provider === "indeed") {
    return { bg: "#2557a7", fg: "#ffffff", mono: "Id", name: "Indeed" };
  }

  return { bg: "#eef0e3", fg: "#4b5f18", mono: "M", name: "Manual" };
}

function formatProvider(provider: string | null) {
  return sourceMeta(provider).name;
}

function statusTone(status: RoleScreenState) {
  if (status === "needs_review") {
    return "danger";
  }

  if (status === "candidate_started") {
    return "warning";
  }

  if (status === "completed") {
    return "success";
  }

  if (status === "published") {
    return "dark";
  }

  return "olive";
}

function formatState(status: RoleScreenState) {
  if (status === "candidate_started") {
    return "In progress";
  }

  if (status === "needs_review") {
    return "Needs review";
  }

  if (status === "published") {
    return "Published";
  }

  return status.replace(/_/g, " ");
}

function candidateHint(role: RoleListItem) {
  if (role.state === "draft") {
    return "Setup not published";
  }

  if (role.state === "needs_review") {
    return "Candidate screen waiting";
  }

  if (role.candidateCount === 0) {
    return "Waiting for first screen";
  }

  return "Screening signals available";
}

function formatRelativeDate(value: string) {
  const timestamp = new Date(value).getTime();
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(deltaMs / 60000));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}
