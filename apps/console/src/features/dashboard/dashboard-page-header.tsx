import Link from "next/link";
import { Download, Plus } from "iconoir-react";
import type { TFunction } from "i18next";

import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../../server/users/user-locale";

export type DashboardHeaderStats = {
  activeRoles: number;
  completed: number;
  drafts: number;
  published: number;
};

export async function DashboardPageHeader({
  needsReviewCount,
  organizationName,
  staleAfterDays,
  staleCount,
  stats,
  userName,
}: {
  needsReviewCount: number;
  organizationName: string;
  staleAfterDays: number;
  staleCount: number;
  stats: DashboardHeaderStats;
  userName: string;
}) {
  const locale = await getAuthenticatedUserLocale();
  const t = getServerT(locale);

  return (
    <section className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-500">
          {organizationName} {t("dashboard.orgDateSeparator")}{" "}
          {formatDateLine(new Date(), locale)}
        </p>
        <h1 className="mt-1.5 text-[clamp(28px,3.4vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
          {formatGreeting(t)},{" "}
          <span className="font-serif italic font-normal">
            {firstNameFor(userName, t)}
          </span>
        </h1>
        <p className="mt-2.5 max-w-[44rem] text-[15px] leading-[1.55] text-ink-600">
          {needsReviewCount === 0
            ? t("dashboard.headerSummaryClear")
            : staleCount > 0
              ? t("dashboard.headerSummaryOverdue", {
                  count: needsReviewCount,
                  days: staleAfterDays,
                  stale: staleCount,
                })
              : t("dashboard.headerSummary", { count: needsReviewCount })}
        </p>
        <p className="mt-2 text-[13px] text-ink-400">
          {[
            t("dashboard.statLiveScreens", { count: stats.published }),
            t("dashboard.statCompletedSessions", { count: stats.completed }),
            t("dashboard.statActiveRoles", {
              count: stats.activeRoles,
              drafts: stats.drafts,
            }),
          ].join(" · ")}
        </p>
      </div>

      {/*
       * Full width and stacked on a phone: side by side, two long labels
       * ("Exporter la file (CSV)", "Nouvel entretien de poste") squeezed onto
       * two lines each and spilled out of their own 38px pill. `nowrap` keeps
       * a label on one line whatever the language it is translated into.
       */}
      <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
        <button
          className="inline-flex h-[38px] w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-900 transition hover:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 sm:w-auto"
          type="button"
        >
          <Download aria-hidden={true} className="h-4 w-4" />
          {t("dashboard.exportQueue")}
        </button>
        <Link
          className="inline-flex h-[38px] w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-ink-900 px-[17px] text-[13px] font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 sm:w-auto"
          href="/roles/new"
        >
          <Plus aria-hidden={true} className="h-4 w-4" />
          {t("dashboard.newRoleScreen")}
        </Link>
      </div>
    </section>
  );
}

function formatDateLine(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(value);
}

function formatGreeting(t: TFunction) {
  const hour = new Date().getHours();
  if (hour < 12) {
    return t("dashboard.greetingMorning");
  }

  if (hour < 18) {
    return t("dashboard.greetingAfternoon");
  }

  return t("dashboard.greetingEvening");
}

function firstNameFor(userName: string, t: TFunction) {
  const [firstName] = userName.split(/\s+/).filter(Boolean);
  return firstName ?? t("dashboard.greetingFallbackName");
}
