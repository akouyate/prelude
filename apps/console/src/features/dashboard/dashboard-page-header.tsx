import Link from "next/link";
import { FilterList, Plus } from "iconoir-react";
import type { TFunction } from "i18next";

import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../../server/users/user-locale";

export async function DashboardPageHeader({
  needsReviewCount,
  organizationName,
  userName,
}: {
  needsReviewCount: number;
  organizationName: string;
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
        <p className="mt-2.5 max-w-[42rem] text-[15px] leading-[1.55] text-ink-600">
          {t("dashboard.headerSummary", { count: needsReviewCount })}
        </p>
      </div>

      <div className="flex gap-2.5">
        <button
          className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-900 transition hover:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          type="button"
        >
          <FilterList aria-hidden={true} className="h-4 w-4" />
          {t("dashboard.export")}
        </button>
        <Link
          className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-[17px] text-[13px] font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
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
