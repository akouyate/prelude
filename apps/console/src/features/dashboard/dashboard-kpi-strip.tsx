import type { ReactNode } from "react";
import { CheckCircle, Microphone, ShieldCheck, Suitcase } from "iconoir-react";
import { MetricCard } from "@prelude/ui";

import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../../server/users/user-locale";

export type DashboardKpiMetrics = {
  activeRoles: number;
  completed: number;
  drafts: number;
  needsReview: number;
  published: number;
};

export async function DashboardKpiStrip({
  metrics,
}: {
  metrics: DashboardKpiMetrics;
}) {
  const t = getServerT(await getAuthenticatedUserLocale());

  return (
    <section className="mt-[26px] grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        active
        icon={<ShieldCheck aria-hidden={true} className="h-4 w-4" />}
        label={t("dashboard.kpiNeedsReviewLabel")}
        meta={t("dashboard.kpiNeedsReviewMeta")}
        value={metrics.needsReview.toString()}
      />
      <KpiCard
        icon={<Microphone aria-hidden={true} className="h-4 w-4" />}
        label={t("dashboard.kpiLiveLabel")}
        meta={t("dashboard.kpiLiveMeta")}
        value={metrics.published.toString()}
      />
      <KpiCard
        icon={<CheckCircle aria-hidden={true} className="h-4 w-4" />}
        label={t("dashboard.kpiCompletedLabel")}
        meta={t("dashboard.kpiCompletedMeta")}
        value={metrics.completed.toString()}
      />
      <KpiCard
        icon={<Suitcase aria-hidden={true} className="h-4 w-4" />}
        label={t("dashboard.kpiActiveRolesLabel")}
        meta={t("dashboard.kpiActiveRolesMeta", { count: metrics.drafts })}
        value={metrics.activeRoles.toString()}
      />
    </section>
  );
}

function KpiCard({
  active = false,
  icon,
  label,
  meta,
  value,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <MetricCard
      active={active}
      className="rounded-[22px] p-5"
      icon={icon}
      label={label}
      meta={meta}
      variant="kpi"
      value={value}
    />
  );
}
