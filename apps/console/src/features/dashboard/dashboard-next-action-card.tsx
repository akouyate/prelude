import Link from "next/link";
import { ArrowRight } from "iconoir-react";

import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../../server/users/user-locale";

export type DashboardNextAction = {
  description: string;
  href: string;
  label: string;
  title: string;
};

export type DashboardNextActionMetrics = {
  drafts: number;
  needsReview: number;
  published: number;
};

export async function DashboardNextActionCard({
  action,
  metrics,
}: {
  action: DashboardNextAction;
  metrics: DashboardNextActionMetrics;
}) {
  const t = getServerT(await getAuthenticatedUserLocale());

  return (
    <section className="overflow-hidden rounded-[24px] bg-ink-900 p-5 text-white">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mint-200">
        {t("dashboard.nextBestAction")}
      </p>
      <h2 className="mt-3 text-2xl font-semibold leading-tight">
        {action.title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-white/68">
        {action.description}
      </p>
      <dl className="mt-5 grid grid-cols-3 gap-2">
        <DarkFact
          label={t("dashboard.nextActionReview")}
          value={metrics.needsReview.toString()}
        />
        <DarkFact
          label={t("dashboard.nextActionLive")}
          value={metrics.published.toString()}
        />
        <DarkFact
          label={t("dashboard.nextActionDrafts")}
          value={metrics.drafts.toString()}
        />
      </dl>
      <Link
        aria-label={action.label}
        className="relative mt-5 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#171715] transition hover:bg-[#f6f3ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-300"
        href={action.href}
      >
        <span className="relative z-10 text-[#171715]">{action.label}</span>
        <ArrowRight
          aria-hidden={true}
          className="relative z-10 h-4 w-4 text-[#171715]"
        />
      </Link>
    </section>
  );
}

function DarkFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-3">
      <dt className="text-xs text-white/55">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-white">{value}</dd>
    </div>
  );
}
