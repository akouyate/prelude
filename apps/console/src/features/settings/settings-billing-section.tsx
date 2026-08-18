"use client";

import * as React from "react";
import { useClerk } from "@clerk/nextjs";
import { ArrowUpRight } from "iconoir-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Button, Notice, StatusBadge, cn, useToastOnce } from "@prelude/ui";

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
  canOfferUsd,
  creditPackAmountCents,
  formatCreditPrice,
  purchaseToastFor,
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toastOnce } = useToastOnce();

  // Read once, on mount, and keep it in state — because the effect below then
  // removes the parameter from the URL. Without that, "credits added" is
  // immortal: it replays on every reload, survives a bookmark, and reappears
  // days later on a page that is no longer describing anything that just
  // happened. `replace` rather than `push` so Back does not walk into the stale
  // toast, and the other parameters (notably `view=billing`) are preserved so
  // the section does not jump back to Profile.
  const [purchaseToast] = React.useState(() =>
    purchaseToastFor(searchParams.get("purchase")),
  );

  React.useEffect(() => {
    if (!searchParams.has("purchase")) {
      return;
    }
    const remaining = new URLSearchParams(searchParams);
    remaining.delete("purchase");
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // Fires exactly once per mount, via `toastOnce` keyed on `purchaseToast`
  // itself rather than a boolean ref: `purchaseToast` was already computed
  // once, in the lazy `useState` initializer above, so its identity is
  // already stable for the life of the mount — keying on it reproduces
  // "fire once, ever, for this mount" without a separate flag. `t`'s
  // identity can change (e.g. a language switch) and re-running this effect
  // after the toast is already showing must be a no-op, not a second toast.
  React.useEffect(() => {
    if (!purchaseToast) {
      return;
    }
    toastOnce(purchaseToast, {
      dismissLabel: t("toast.dismiss"),
      duration: purchaseToast.duration,
      message: t(purchaseToast.key),
      tone: purchaseToast.tone,
    });
  }, [purchaseToast, t, toastOnce]);

  // Plan rule 4's chain: explicit user toggle > server-resolved request
  // geography > EUR. The geography link is resolved server-side, in the
  // settings loader (`resolveDisplayCurrencyFromRequest`, from
  // `x-vercel-ip-country`/`Accept-Language`), and arrives here as
  // `creditBilling.initialDisplayCurrency` — so the very first server-rendered
  // paint already carries the right symbol. There is no client-side correction
  // after hydration (the old `navigator.language` effect is gone): the server
  // and the client never disagree, because the client starts from what the
  // server already resolved.
  //
  // Clamped to EUR when `usdAvailable` is false so a server-resolved "USD" can
  // never seed a state the ladder cannot actually show in full (rule 4's
  // display-integrity guard — see `canOfferUsd`).
  const usdAvailable = canOfferUsd(creditBilling.packs);
  const [currency, setCurrency] = React.useState<DisplayCurrency>(() =>
    usdAvailable ? creditBilling.initialDisplayCurrency : "EUR",
  );

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
    } finally {
      // Runs on the success path too, `return` notwithstanding. `assign` only
      // *starts* a navigation — if it is blocked or fails, an unreset pending id
      // would leave every buy button disabled until a manual reload. When the
      // navigation does happen the page unloads before this repaint is visible.
      setPendingPackId(null);
    }
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
        <CurrencyToggle
          currency={currency}
          onChange={setCurrency}
          usdAvailable={usdAvailable}
        />
      </div>

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

      {/*
        The catalogue stays visible to everyone — knowing what a pack costs is not
        a privilege — but only a manager gets the controls. The server refuses a
        non-manager anyway (`canPurchaseCredits`, re-derived from the session in
        both the action and the return route); this flag is what stops the console
        offering a button whose only possible answer is "not allowed".
      */}
      <div className="mt-5 grid gap-3 border-t border-ink-100 pt-5 sm:grid-cols-3">
        {creditBilling.packs.map((pack) => (
          <CreditPackCard
            canPurchase={creditBilling.canPurchase}
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
        line opens the same checkout, through the same action, and is gated by the
        same role (visibility was never an authorization boundary).
      */}
      {creditBilling.volumePackId && creditBilling.canPurchase ? (
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

      {creditBilling.canPurchase ? null : (
        <p className="mt-4 text-xs leading-5 text-ink-500">
          {t("settings.billing.credits.nonManagerHint")}
        </p>
      )}

      {checkoutFailed ? (
        <Notice className="mt-4" role="alert" tone="warning">
          {t("settings.billing.credits.checkoutFailed")}
        </Notice>
      ) : null}
    </SettingsPanel>
  );
}

function CreditPackCard({
  canPurchase,
  currency,
  locale,
  onBuy,
  pack,
  pending,
  pendingElsewhere,
}: {
  canPurchase: boolean;
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
      {canPurchase ? (
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
      ) : null}
    </div>
  );
}

function CurrencyToggle({
  currency,
  onChange,
  usdAvailable,
}: {
  currency: DisplayCurrency;
  onChange: (currency: DisplayCurrency) => void;
  usdAvailable: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("settings.billing.credits.currencyLabel")}
      className="flex shrink-0 items-center gap-1 rounded-full border border-ink-100 p-1"
      role="group"
    >
      {(["EUR", "USD"] as const).map((option) => {
        // Rule 4's display-integrity guard: offering USD when the catalogue
        // cannot fully price in dollars would let the ladder mix € and $ rows
        // under a toggle that claims one currency. Disabled rather than hidden,
        // with a title explaining why, so the option's absence reads as a fact
        // about this catalogue and not a bug.
        const disabled = option === "USD" && !usdAvailable;

        return (
          <button
            aria-pressed={currency === option}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              currency === option
                ? "bg-ink-900 text-white"
                : "text-ink-500 hover:text-ink-800",
              disabled && "cursor-not-allowed opacity-40 hover:text-ink-500",
            )}
            disabled={disabled}
            key={option}
            onClick={() => {
              onChange(option);
            }}
            title={
              disabled
                ? t("settings.billing.credits.usdUnavailable")
                : undefined
            }
            type="button"
          >
            {option}
          </button>
        );
      })}
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
