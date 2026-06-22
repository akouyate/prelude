import Link from "next/link";
import { StatusBadge } from "@prelude/ui";
import type { TFunction } from "i18next";

import { getServerT } from "../../libs/i18n-server";
import { getAuthenticatedUserLocale } from "../../server/users/user-locale";

export type DashboardActiveRoleState =
  | "candidate_started"
  | "completed"
  | "draft"
  | "needs_review"
  | "paused"
  | "published";

export type DashboardActiveRole = {
  candidateCount: number;
  href: string;
  id: string;
  location: string | null;
  sourceProvider: string | null;
  state: DashboardActiveRoleState;
  title: string;
};

export async function DashboardActiveRoles({
  roles,
}: {
  roles: DashboardActiveRole[];
}) {
  const t = getServerT(await getAuthenticatedUserLocale());

  return (
    <section
      className="rounded-[24px] border border-ink-100 bg-white/74 p-4 backdrop-blur"
      id="interviews"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink-950">
            {t("dashboard.activeRolesTitle")}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {t("dashboard.activeRolesSubtitle")}
          </p>
        </div>
        <Link
          className="shrink-0 cursor-pointer text-[12.5px] font-medium text-ink-500 transition hover:text-ink-950"
          href="/roles"
        >
          {t("dashboard.viewAll")}
        </Link>
      </div>

      {roles.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {roles.slice(0, 4).map((role) => (
            <Link
              className="group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white/60 px-3.5 py-3 transition hover:border-ink-200 hover:bg-white"
              href={role.href}
              key={role.id}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink-950">
                  {role.title}
                </span>
                <span className="mt-1 block truncate text-xs text-ink-500">
                  {role.location ?? t("dashboard.locationNotSet")} ·{" "}
                  {formatProvider(role.sourceProvider, t)} ·{" "}
                  {t("dashboard.candidateCount", { count: role.candidateCount })}
                </span>
              </span>
              <StatusBadge
                className="shrink-0 whitespace-nowrap"
                tone={statusTone(role.state)}
              >
                {formatInterviewState(role.state, t)}
              </StatusBadge>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-ink-100 bg-white/54 p-5">
          <p className="text-sm font-semibold text-ink-950">
            {t("dashboard.activeRolesEmptyTitle")}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-500">
            {t("dashboard.activeRolesEmptyBody")}
          </p>
        </div>
      )}
    </section>
  );
}

function formatProvider(provider: string | null, t: TFunction) {
  if (!provider || provider === "manual") {
    return t("dashboard.providerManual");
  }

  if (provider === "linkedin") {
    return t("dashboard.providerLinkedin");
  }

  if (provider === "indeed") {
    return t("dashboard.providerIndeed");
  }

  return humanize(provider);
}

function formatInterviewState(status: DashboardActiveRoleState, t: TFunction) {
  if (status === "candidate_started") {
    return t("dashboard.stateInProgress");
  }

  if (status === "needs_review") {
    return t("dashboard.stateNeedsReview");
  }

  if (status === "completed") {
    return t("dashboard.stateCompleted");
  }

  if (status === "published") {
    return t("dashboard.statePublished");
  }

  if (status === "paused") {
    return t("dashboard.statePaused");
  }

  if (status === "draft") {
    return t("dashboard.stateDraft");
  }

  return humanize(status);
}

function statusTone(status: DashboardActiveRoleState) {
  if (status === "needs_review") {
    return "danger";
  }

  if (status === "candidate_started") {
    return "warning";
  }

  if (status === "published") {
    return "dark";
  }

  if (status === "paused") {
    return "muted";
  }

  if (status === "completed") {
    return "success";
  }

  return "olive";
}

function humanize(value: string) {
  return value.replace(/_/g, " ");
}
