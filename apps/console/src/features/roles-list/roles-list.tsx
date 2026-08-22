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
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  IconButton,
  MetricCard,
  SegmentedTabs,
  StatusBadge,
  cn,
} from "@prelude/ui";

import { candidateAppUrl } from "../../libs/candidate-app-url";
import { useCopyLinkFeedback } from "../../libs/use-copy-link-feedback";
import { CursorPagination } from "../console-list/cursor-pagination";
import {
  type RoleFilter,
  type RoleSort,
  useRoleListQueryState,
} from "../console-list/list-query-state";

export type RoleScreenState =
  | "candidate_started"
  | "completed"
  | "draft"
  | "needs_review"
  | "paused"
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

export function RolesList({
  counts,
  nextCursor,
  organizationName,
  previousCursor,
  roles,
}: {
  counts: Record<RoleFilter, number>;
  nextCursor: string | null;
  organizationName: string;
  previousCursor: string | null;
  roles: RoleListItem[];
}) {
  const { t } = useTranslation();
  const [listQuery, setListQuery] = useRoleListQueryState();
  const [queryDraft, setQueryDraft] = React.useState(listQuery.q);
  const { copiedKey: copiedId, copy } = useCopyLinkFeedback();

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
    (filter: RoleFilter) => void setListQuery({ cursor: null, filter }),
    [setListQuery],
  );

  const setSort = React.useCallback(
    (sort: RoleSort) => void setListQuery({ cursor: null, sort }),
    [setListQuery],
  );

  const handleCopy = React.useCallback(
    async (role: RoleListItem) => {
      if (!role.candidatePath) {
        return;
      }

      await copy(candidateAppUrl(role.candidatePath), role.id);
    },
    [copy],
  );

  return (
    <div>
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-500">
            {t("roles.headerEyebrow", { organizationName })}
          </p>
          <h1 className="mt-1.5 text-[clamp(28px,3.4vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
            {t("roles.title")}{" "}
            <span className="font-serif italic font-normal">
              {t("roles.titleEmphasis")}
            </span>
          </h1>
          <p className="mt-2.5 max-w-[42rem] text-[15px] leading-[1.55] text-ink-600">
            {t("roles.subtitle")}
          </p>
        </div>

        <Link
          className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-[17px] text-[13px] font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          href="/roles/new"
        >
          <Plus aria-hidden={true} className="h-4 w-4" />
          {t("roles.newRoleScreen")}
        </Link>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          active={listQuery.filter === "needs_review"}
          icon={<CheckCircle aria-hidden={true} className="h-4 w-4" />}
          label={t("roles.summaryNeedsReviewLabel")}
          meta={t("roles.summaryNeedsReviewSub")}
          onClick={() => setFilter("needs_review")}
          value={String(counts.needs_review)}
        />
        <MetricCard
          active={listQuery.filter === "live"}
          icon={<Microphone aria-hidden={true} className="h-4 w-4" />}
          label={t("roles.summaryLiveLabel")}
          meta={t("roles.summaryLiveSub")}
          onClick={() => setFilter("live")}
          value={String(counts.live)}
        />
        <MetricCard
          active={listQuery.filter === "draft"}
          icon={<EditPencil aria-hidden={true} className="h-4 w-4" />}
          label={t("roles.summaryDraftLabel")}
          meta={t("roles.summaryDraftSub")}
          onClick={() => setFilter("draft")}
          value={String(counts.draft)}
        />
        <MetricCard
          active={listQuery.filter === "completed"}
          icon={<CheckCircle aria-hidden={true} className="h-4 w-4" />}
          label={t("roles.summaryCompletedLabel")}
          meta={t("roles.summaryCompletedSub")}
          onClick={() => setFilter("completed")}
          value={String(counts.completed)}
        />
      </section>

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel={t("roles.statusFilterAria")}
          onValueChange={(value) => setFilter(value as RoleFilter)}
          options={[
            { label: t("roles.tabAll", { count: counts.all }), value: "all" },
            {
              label: t("roles.tabLive", { count: counts.live }),
              value: "live",
            },
            {
              label: t("roles.tabNeedsReview", { count: counts.needs_review }),
              value: "needs_review",
            },
            {
              label: t("roles.tabDrafts", { count: counts.draft }),
              value: "draft",
            },
            {
              label: t("roles.tabCompleted", { count: counts.completed }),
              value: "completed",
            },
          ]}
          value={listQuery.filter}
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-[38px] items-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3 text-ink-400 focus-within:border-ink-400 focus-within:bg-white">
            <Search aria-hidden={true} className="h-4 w-4 shrink-0" />
            <span className="sr-only">{t("roles.searchRoles")}</span>
            <input
              className="w-36 bg-transparent text-[13px] text-ink-950 outline-none placeholder:text-ink-400"
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder={t("roles.searchRoles")}
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

      <section className="mt-4 overflow-hidden rounded-[24px] border border-ink-100 bg-white/74 backdrop-blur">
        <div className="hidden grid-cols-[minmax(0,1.55fr)_150px_minmax(0,1fr)_150px] gap-4 border-b border-ink-100 px-[22px] py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-400 md:grid">
          <span>{t("roles.columnRole")}</span>
          <span>{t("roles.columnSetup")}</span>
          <span>{t("roles.columnCandidateScreens")}</span>
          <span className="text-right">{t("roles.columnUpdated")}</span>
        </div>

        {roles.length > 0 ? (
          <div className="divide-y divide-ink-100">
            {roles.map((role) => (
              <RoleRow
                copied={copiedId === role.id}
                key={role.id}
                onCopy={() => handleCopy(role)}
                role={role}
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef0e3] text-olive-900">
              <Microphone aria-hidden={true} className="h-5 w-5" />
            </span>
            <p className="mt-4 text-sm font-semibold text-ink-950">
              {t("roles.emptyTitle")}
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-500">
              {t("roles.emptyBody")}
            </p>
          </div>
        )}
        <CursorPagination
          nextCursor={nextCursor}
          previousCursor={previousCursor}
        />
      </section>
    </div>
  );
}

function RoleRow({
  copied,
  onCopy,
  role,
  t,
}: {
  copied: boolean;
  onCopy: () => void;
  role: RoleListItem;
  t: TFunction;
}) {
  const source = sourceMeta(role.sourceProvider, t);
  const candidateLine =
    role.candidateCount === 0
      ? t("roles.candidateScreensNone")
      : t("roles.candidateScreensCount", { count: role.candidateCount });

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
            {role.location ?? t("roles.locationNotSet")} · {source.name}
          </span>
        </span>
      </Link>

      <span>
        <StatusBadge tone={statusTone(role.state)}>
          {formatState(role.state, t)}
        </StatusBadge>
      </span>

      <span>
        <span className="block text-[13.5px] font-semibold text-ink-700">
          {candidateLine}
        </span>
        <span className="mt-1 block text-[11.5px] text-ink-400">
          {candidateHint(role, t)}
        </span>
      </span>

      <span className="flex items-center justify-between gap-3 md:justify-end">
        <span className="text-[12.5px] text-ink-500">
          {formatRelativeDate(role.updatedAt, t)}
        </span>
        <span className="flex items-center gap-1.5">
          {role.candidatePath ? (
            // This icon-only button has no visible label, so the aria-label
            // swap here is the only in-place affordance — the toast is the
            // real feedback here (unlike the copy buttons in
            // interview-detail/the builder, which also swap their icon/text
            // in place).
            <IconButton
              aria-label={
                copied ? t("roles.copyLinkCopied") : t("roles.copyLink")
              }
              className={
                copied
                  ? "border-[#cdd9b6] bg-[#eef0e3] text-olive-900"
                  : undefined
              }
              onClick={onCopy}
              size="sm"
            >
              <Copy aria-hidden={true} className="h-4 w-4" />
            </IconButton>
          ) : null}
          <Link
            aria-label={t("roles.openRole")}
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

function nextSort(sort: RoleSort): RoleSort {
  if (sort === "recent") {
    return "alpha";
  }

  return "recent";
}

function formatSort(sort: RoleSort, t: TFunction) {
  if (sort === "alpha") {
    return t("roles.sortAlpha");
  }

  return t("roles.sortRecent");
}

function sourceMeta(provider: string | null, t: TFunction) {
  if (provider === "linkedin") {
    return {
      bg: "#0a66c2",
      fg: "#ffffff",
      mono: "in",
      name: t("roles.providerLinkedin"),
    };
  }

  if (provider === "indeed") {
    return {
      bg: "#2557a7",
      fg: "#ffffff",
      mono: "Id",
      name: t("roles.providerIndeed"),
    };
  }

  return {
    bg: "#eef0e3",
    fg: "#4b5f18",
    mono: "M",
    name: t("roles.providerManual"),
  };
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

  if (status === "paused") {
    return "muted";
  }

  return "olive";
}

function formatState(status: RoleScreenState, t: TFunction) {
  if (status === "candidate_started") {
    return t("roles.stateInProgress");
  }

  if (status === "needs_review") {
    return t("roles.stateNeedsReview");
  }

  if (status === "published") {
    return t("roles.statePublished");
  }

  if (status === "paused") {
    return t("roles.statePaused");
  }

  return status.replace(/_/g, " ");
}

function candidateHint(role: RoleListItem, t: TFunction) {
  if (role.state === "draft") {
    return t("roles.hintSetupNotPublished");
  }

  if (role.state === "needs_review") {
    return t("roles.hintScreenWaiting");
  }

  if (role.candidateCount === 0) {
    return t("roles.hintWaitingFirstScreen");
  }

  return t("roles.hintSignalsAvailable");
}

function formatRelativeDate(value: string, t: TFunction) {
  const timestamp = new Date(value).getTime();
  const deltaMs = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(deltaMs / 60000));

  if (minutes < 60) {
    return t("roles.relativeMinutes", { count: minutes });
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return t("roles.relativeHours", { count: hours });
  }

  const days = Math.round(hours / 24);
  if (days < 7) {
    return t("roles.relativeDays", { count: days });
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}
