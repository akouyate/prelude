import Link from "next/link";
import { FilterList, Plus } from "iconoir-react";

export function DashboardPageHeader({
  needsReviewCount,
  organizationName,
  userName,
}: {
  needsReviewCount: number;
  organizationName: string;
  userName: string;
}) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-500">
          {organizationName} · {formatDateLine(new Date())}
        </p>
        <h1 className="mt-1.5 text-[clamp(28px,3.4vw,38px)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950">
          {formatGreeting()},{" "}
          <span className="font-serif italic font-normal">
            {firstNameFor(userName)}
          </span>
        </h1>
        <p className="mt-2.5 max-w-[42rem] text-[15px] leading-[1.55] text-ink-600">
          {needsReviewCount} screens are waiting on review. Triage signals,
          then move only qualified profiles forward.
        </p>
      </div>

      <div className="flex gap-2.5">
        <button
          className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-900 transition hover:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          type="button"
        >
          <FilterList aria-hidden={true} className="h-4 w-4" />
          Export
        </button>
        <Link
          className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-900 px-[17px] text-[13px] font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          href="/interviews/new"
        >
          <Plus aria-hidden={true} className="h-4 w-4" />
          New role screen
        </Link>
      </div>
    </section>
  );
}

function formatDateLine(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(value);
}

function formatGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function firstNameFor(userName: string) {
  const [firstName] = userName.split(/\s+/).filter(Boolean);
  return firstName ?? "there";
}
