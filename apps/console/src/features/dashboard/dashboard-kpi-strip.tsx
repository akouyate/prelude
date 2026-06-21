import type { ReactNode } from "react";
import { CheckCircle, Microphone, ShieldCheck, Suitcase } from "iconoir-react";

export type DashboardKpiMetrics = {
  activeRoles: number;
  completed: number;
  drafts: number;
  needsReview: number;
  published: number;
};

export function DashboardKpiStrip({ metrics }: { metrics: DashboardKpiMetrics }) {
  return (
    <section className="mt-[26px] grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        active
        icon={<ShieldCheck aria-hidden={true} className="h-4 w-4" />}
        label="Needs review"
        meta="Ready for human review"
        value={metrics.needsReview.toString()}
      />
      <KpiCard
        icon={<Microphone aria-hidden={true} className="h-4 w-4" />}
        label="Live screens"
        meta="Published & collecting"
        value={metrics.published.toString()}
      />
      <KpiCard
        icon={<CheckCircle aria-hidden={true} className="h-4 w-4" />}
        label="Completed screens"
        meta="Finished candidate sessions"
        value={metrics.completed.toString()}
      />
      <KpiCard
        icon={<Suitcase aria-hidden={true} className="h-4 w-4" />}
        label="Active roles"
        meta={`${metrics.drafts} draft${metrics.drafts > 1 ? "s" : ""} in progress`}
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
    <div
      className={
        active
          ? "rounded-[22px] border border-[#e2e6d3] bg-[#eef0e3] p-5"
          : "rounded-[22px] border border-ink-100 bg-white/72 p-5 backdrop-blur"
      }
    >
      <div className="flex items-center justify-between gap-4">
        <span
          className={
            active
              ? "grid h-8 w-8 place-items-center rounded-full bg-white/60 text-olive-900"
              : "grid h-8 w-8 place-items-center rounded-full bg-[#f4f2ea] text-ink-600"
          }
        >
          {icon}
        </span>
        <span className="text-4xl font-semibold leading-none tracking-normal text-ink-950">
          {value}
        </span>
      </div>
      <p className="mt-5 text-sm font-semibold text-ink-800">{label}</p>
      <p className="mt-2 text-xs text-ink-500">{meta}</p>
    </div>
  );
}
