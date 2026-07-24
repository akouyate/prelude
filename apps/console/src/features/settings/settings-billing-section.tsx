"use client";

import { useClerk } from "@clerk/nextjs";
import { ArrowUpRight } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Button, StatusBadge, cn } from "@prelude/ui";

import { SettingsPanel } from "./settings-primitives";
import type { WorkspaceSettingsData } from "./settings-types";
import {
  billingStateDescriptionKey,
  billingStateTranslationKey,
  usagePercentage,
} from "./settings-billing-helpers";

const billingStateTones = {
  active: "success",
  canceled: "warning",
  free: "neutral",
  past_due: "danger",
  trialing: "olive",
  unavailable: "danger",
  unconfigured: "muted",
} as const satisfies Record<
  WorkspaceSettingsData["billing"]["state"],
  "danger" | "muted" | "neutral" | "olive" | "success" | "warning"
>;

export function BillingSection({
  billing,
}: {
  billing: WorkspaceSettingsData["billing"];
}) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const period = formatBillingPeriod(
    billing.periodStart,
    billing.periodEnd,
    locale,
  );

  return (
    <SettingsPanel>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              {t("settings.billing.currentPlan")}
            </p>
            <StatusBadge tone={billingStateTones[billing.state]}>
              {t(billingStateTranslationKey(billing.state))}
            </StatusBadge>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.015em] text-ink-950">
            {billing.planName}
          </h2>
          <p className="mt-2 max-w-[52ch] text-[13.5px] leading-5 text-ink-600">
            {t(billingStateDescriptionKey(billing.state))}
          </p>
          {period ? (
            <p className="mt-3 text-xs text-ink-500">
              <span className="font-medium text-ink-700">
                {t("settings.billing.period")}
              </span>{" "}
              {period}
            </p>
          ) : null}
        </div>

        {billing.canManageBilling ? (
          <ManageBillingButton />
        ) : (
          <DisabledBillingButton
            hint={t(
              billing.manageBillingUnavailableReason === "local_mock"
                ? "settings.billing.localMockManageHint"
                : billing.manageBillingUnavailableReason === "not_configured"
                  ? "settings.billing.unconfiguredManageHint"
                  : "settings.billing.nonOwnerManageHint",
            )}
          />
        )}
      </div>

      <div className="mt-6 grid gap-5 border-t border-ink-100 pt-5 sm:grid-cols-2">
        <BillingUsageMeter
          label={t("settings.billing.candidateInterviews")}
          limit={billing.limits.candidateInterviews}
          usage={billing.usage.candidateInterviews}
        />
        <BillingUsageMeter
          label={t("settings.billing.publishedRoles")}
          limit={billing.limits.publishedRoles}
          usage={billing.usage.publishedRoles}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
        <div>
          <p className="text-sm font-semibold text-ink-950">
            {t("settings.billing.recording")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-500">
            {t("settings.billing.recordingDescription")}
          </p>
        </div>
        <StatusBadge
          tone={billing.entitlements.recording ? "success" : "muted"}
        >
          {t(
            billing.entitlements.recording
              ? "settings.billing.included"
              : "settings.billing.notIncluded",
          )}
        </StatusBadge>
      </div>
    </SettingsPanel>
  );
}

function DisabledBillingButton({ hint }: { hint: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex max-w-[18rem] flex-col items-start gap-2 sm:items-end">
      <Button disabled title={hint} type="button" variant="secondary">
        {t("settings.billing.manageBilling")}
      </Button>
      <p className="text-right text-xs leading-5 text-ink-500">{hint}</p>
    </div>
  );
}

function ManageBillingButton() {
  const { t } = useTranslation();
  const clerk = useClerk();

  return (
    <Button
      aria-label={t("settings.billing.manageBilling")}
      onClick={() => {
        clerk.openOrganizationProfile({ __experimental_startPath: "/billing" });
      }}
      type="button"
      variant="secondary"
    >
      <ArrowUpRight aria-hidden={true} className="h-4 w-4" />
      {t("settings.billing.manageBilling")}
    </Button>
  );
}

function BillingUsageMeter({
  label,
  limit,
  usage,
}: {
  label: string;
  limit: number | null;
  usage: number;
}) {
  const { t } = useTranslation();
  const percentage = usagePercentage(usage, limit);
  const usageLabel =
    limit === null
      ? t("settings.billing.usageUnlimited", { used: usage })
      : t("settings.billing.usage", { limit, used: usage });

  return (
    <div
      aria-label={label}
      className="min-w-0"
      role={percentage === null ? "group" : "meter"}
      {...(percentage === null
        ? {}
        : {
            "aria-valuemax": limit ?? undefined,
            "aria-valuemin": 0,
            "aria-valuenow": usage,
          })}
    >
      <div className="flex items-center justify-between gap-3 text-[12.5px] text-ink-600">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-medium text-ink-900">{usageLabel}</span>
      </div>
      {percentage === null ? (
        <p className="mt-2 text-xs text-ink-400">
          {t("settings.billing.unlimited")}
        </p>
      ) : (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
          <span
            className={cn(
              "block h-full rounded-full",
              percentage >= 90 ? "bg-coral-500" : "bg-olive-800",
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function formatBillingPeriod(
  periodStart: string | null,
  periodEnd: string | null,
  locale: string,
) {
  const start = formatBillingDate(periodStart, locale);
  const end = formatBillingDate(periodEnd, locale);

  if (start && end) {
    return `${start} - ${end}`;
  }

  return start ?? end;
}

function formatBillingDate(value: string | null, locale: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
