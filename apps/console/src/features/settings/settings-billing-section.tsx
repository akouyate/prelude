"use client";

import * as React from "react";
import { useClerk } from "@clerk/nextjs";
import { ArrowUpRight } from "iconoir-react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Button, Notice, StatusBadge, cn } from "@prelude/ui";

import { startCreditPackCheckout } from "../../server/billing/credit-checkout-action";
import { SettingsPanel } from "./settings-primitives";
import type {
  WorkspaceCreditBilling,
  WorkspaceCreditPack,
  WorkspaceSettingsData,
} from "./settings-types";
import {
  billingStateDescriptionKey,
  billingStateTranslationKey,
  creditPackAmountCents,
  defaultDisplayCurrency,
  formatCreditPrice,
  purchaseBannerFor,
  usagePercentage,
  type DisplayCurrency,
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
  creditBilling,
}: {
  billing: WorkspaceSettingsData["billing"];
  creditBilling: WorkspaceSettingsData["creditBilling"];
}) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const period = formatBillingPeriod(
    billing.periodStart,
    billing.periodEnd,
    locale,
  );

  return (
    <div className="flex flex-col gap-[18px]">
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

      {/*
        Flag-gated (#140): `creditBilling` is null whenever the credit kill
        switch is off or Stripe is unconfigured, and the whole buy surface then
        never renders — no prices the console has no way to charge.
      */}
      {creditBilling ? <CreditPurchasePanel creditBilling={creditBilling} /> : null}
    </div>
  );
}

/**
 * The prepaid buy surface: what the workspace holds, what it can buy, and what
 * just happened if the recruiter came back from Stripe.
 *
 * Everything it shows is a display cache. Checkout re-reads the Stripe Price and
 * resolves the buyer's currency from their location (amendment 22), so the toggle
 * below decides which cached amount is PRINTED and nothing else.
 */
function CreditPurchasePanel({
  creditBilling,
}: {
  creditBilling: WorkspaceCreditBilling;
}) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const searchParams = useSearchParams();
  const banner = purchaseBannerFor(searchParams.get("purchase"));

  // Starts on the catalogue default and moves to the browser's currency after
  // hydration. Reading `navigator` during render would make the server and the
  // client disagree on the first paint.
  const [currency, setCurrency] = React.useState<DisplayCurrency>("EUR");
  React.useEffect(() => {
    setCurrency(defaultDisplayCurrency(navigator.language));
  }, []);

  const [pendingPackId, setPendingPackId] = React.useState<string | null>(null);
  const [checkoutFailed, setCheckoutFailed] = React.useState(false);

  const openCheckout = React.useCallback(async (packId: string) => {
    setCheckoutFailed(false);
    setPendingPackId(packId);
    try {
      const result = await startCreditPackCheckout(packId);
      if (result.url) {
        // A full navigation, not a router push: the destination is Stripe's
        // domain, which the Next router cannot own.
        window.location.assign(result.url);
        return;
      }
      // Every refusal reads the same to the recruiter. The distinctions
      // (`unknown_pack`, `not_configured`, …) are ours to act on, not theirs.
      setCheckoutFailed(true);
    } catch {
      setCheckoutFailed(true);
    }
    setPendingPackId(null);
  }, []);

  return (
    <SettingsPanel>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.015em] text-ink-950">
            {t("settings.billing.credits.title")}
          </h2>
          <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-5 text-ink-600">
            {t("settings.billing.credits.description")}
          </p>
        </div>
        <CurrencyToggle currency={currency} onChange={setCurrency} />
      </div>

      {banner ? (
        <Notice className="mt-4" role="status" tone={banner.tone}>
          {t(banner.key)}
        </Notice>
      ) : null}

      {/*
        Amendment 15 — never a bare number. The split says what was actually paid
        for (the First Five are a one-off, not an allowance) and the expiry line
        says what is about to be lost, so nobody discovers the 12-month clock the
        day their balance shrinks.
      */}
      <div className="mt-5 border-t border-ink-100 pt-4">
        <p className="text-2xl font-semibold tracking-[-0.015em] text-ink-950">
          {t("settings.billing.credits.balancePaid", {
            count: creditBilling.paidAvailable,
          })}
          <span className="text-ink-400"> · </span>
          {t("settings.billing.credits.balanceFree", {
            count: creditBilling.freeAvailable,
          })}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-ink-500">
          {creditBilling.nextExpiry
            ? t("settings.billing.credits.nextExpiry", {
                count: creditBilling.nextExpiry.credits,
                date: formatExpiryDate(
                  creditBilling.nextExpiry.expiresAt,
                  locale,
                ),
              })
            : t("settings.billing.credits.expiryNote")}
        </p>
      </div>

      <div className="mt-5 grid gap-3 border-t border-ink-100 pt-5 sm:grid-cols-3">
        {creditBilling.packs.map((pack) => (
          <CreditPackCard
            currency={currency}
            key={pack.id}
            locale={locale}
            onBuy={openCheckout}
            pack={pack}
            pending={pendingPackId === pack.id}
            pendingElsewhere={pendingPackId !== null && pendingPackId !== pack.id}
          />
        ))}
      </div>

      {/*
        Amendment 20 — the quiet pack's gate. `visibility: "quiet"` keeps
        `volume_1000` off the ladder above, but it stays fully purchasable: this
        line opens the same checkout, through the same action.
      */}
      {creditBilling.volumePackId ? (
        <button
          className="mt-4 cursor-pointer text-left text-[12.5px] font-medium text-olive-900 underline underline-offset-4 hover:text-olive-800 disabled:pointer-events-none disabled:opacity-50"
          disabled={pendingPackId !== null}
          onClick={() => {
            void openCheckout(creditBilling.volumePackId as string);
          }}
          type="button"
        >
          {t("settings.billing.credits.volumeGate")}
        </button>
      ) : null}

      {checkoutFailed ? (
        <Notice className="mt-4" role="alert" tone="warning">
          {t("settings.billing.credits.checkoutFailed")}
        </Notice>
      ) : null}
    </SettingsPanel>
  );
}

function CreditPackCard({
  currency,
  locale,
  onBuy,
  pack,
  pending,
  pendingElsewhere,
}: {
  currency: DisplayCurrency;
  locale: string;
  onBuy: (packId: string) => Promise<void>;
  pack: WorkspaceCreditPack;
  pending: boolean;
  pendingElsewhere: boolean;
}) {
  const { t } = useTranslation();
  const price = creditPackAmountCents(pack, currency);

  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-ink-100 bg-white/60 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950">
          {t("settings.billing.credits.packCredits", {
            count: pack.creditsGranted,
          })}
        </p>
        <p className="mt-1 text-xl font-semibold tracking-[-0.015em] text-ink-950">
          {formatCreditPrice(price.amountCents, price.currency, locale)}
        </p>
      </div>
      <Button
        className="w-full"
        disabled={pending || pendingElsewhere}
        onClick={() => {
          void onBuy(pack.id);
        }}
        type="button"
        variant="secondary"
      >
        {t(
          pending
            ? "settings.billing.credits.opening"
            : "settings.billing.credits.buy",
        )}
      </Button>
    </div>
  );
}

function CurrencyToggle({
  currency,
  onChange,
}: {
  currency: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("settings.billing.credits.currencyLabel")}
      className="flex shrink-0 items-center gap-1 rounded-full border border-ink-100 p-1"
      role="group"
    >
      {(["EUR", "USD"] as const).map((option) => (
        <button
          aria-pressed={currency === option}
          className={cn(
            "cursor-pointer rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            currency === option
              ? "bg-ink-900 text-white"
              : "text-ink-500 hover:text-ink-800",
          )}
          key={option}
          onClick={() => {
            onChange(option);
          }}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function formatExpiryDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
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
