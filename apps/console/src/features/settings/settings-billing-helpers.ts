import type {
  WorkspaceCreditPack,
  WorkspaceSettingsData,
} from "./settings-types";

export type BillingState = WorkspaceSettingsData["billing"]["state"];

export function usagePercentage(usage: number, limit: number | null) {
  if (limit === null) {
    return null;
  }

  if (limit <= 0) {
    return usage > 0 ? 100 : 0;
  }

  return Math.min(Math.max((usage / limit) * 100, 0), 100);
}

export function billingStateTranslationKey(state: BillingState) {
  return `settings.billing.states.${state}` as const;
}

export function billingStateDescriptionKey(state: BillingState) {
  if (state === "canceled") {
    return "settings.billing.canceledDescription" as const;
  }
  if (state === "past_due") {
    return "settings.billing.pastDueDescription" as const;
  }
  if (state === "unavailable") {
    return "settings.billing.unavailableDescription" as const;
  }

  return "settings.billing.description" as const;
}

export type DisplayCurrency = "EUR" | "USD";

export type PurchaseBanner = {
  tone: "info" | "success" | "warning";
  key: string;
};

/**
 * Translates `?purchase=` into a banner.
 *
 * The parameter is in the address bar, so a recruiter can put anything in it.
 * Everything that is not one of the four words `/api/billing/checkout-return`
 * writes lands on the same generic line — the raw value is NEVER rendered, both
 * because it would be meaningless to the reader and because a query string is
 * not a string this app should ever echo back onto the page.
 */
export function purchaseBannerFor(value: string | null): PurchaseBanner | null {
  if (!value) {
    return null;
  }

  if (value === "granted" || value === "already") {
    // "already" means the webhook fulfilled the session before the browser came
    // back. The credits are there; the distinction is ours, not the buyer's.
    return { tone: "success", key: "settings.billing.credits.purchaseGranted" };
  }

  if (value === "processing") {
    return {
      tone: "info",
      key: "settings.billing.credits.purchaseProcessing",
    };
  }

  if (value === "cancelled") {
    return {
      tone: "info",
      key: "settings.billing.credits.purchaseCancelled",
    };
  }

  return { tone: "warning", key: "settings.billing.credits.purchaseFailed" };
}

/**
 * Amendment 22: US direct sales, so the buy surface must be able to quote
 * dollars. The default follows the browser's REGION, not its language — "en"
 * alone is as much Dublin as Denver, and the catalogue's default currency is the
 * euro. The recruiter can flip the toggle either way; Checkout then charges in
 * whatever currency Stripe resolves from their location, which is why this only
 * ever decides what is printed.
 */
export function defaultDisplayCurrency(
  locale: string | undefined,
): DisplayCurrency {
  const region = locale?.split("-")[1]?.toUpperCase();

  return region === "US" ? "USD" : "EUR";
}

/**
 * The amount to print for a pack, and the currency it is actually in. A pack
 * whose Stripe Price carries no USD `currency_options` entry has no dollar
 * amount to show, and inventing one by conversion would quote a price Checkout
 * would then contradict — so it falls back to the euro figure and says so.
 */
export function creditPackAmountCents(
  pack: Pick<WorkspaceCreditPack, "unitAmountCents" | "unitAmountCentsUsd">,
  currency: DisplayCurrency,
): { amountCents: number; currency: DisplayCurrency } {
  if (currency === "USD" && pack.unitAmountCentsUsd !== null) {
    return { amountCents: pack.unitAmountCentsUsd, currency: "USD" };
  }

  return { amountCents: pack.unitAmountCents, currency: "EUR" };
}

export function formatCreditPrice(
  amountCents: number,
  currency: DisplayCurrency,
  locale: string,
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    // The ladder is priced in round units; trailing ",00" is noise on a button.
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amountCents / 100);
}
