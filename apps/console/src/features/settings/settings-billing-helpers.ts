import type { ToastTone } from "@prelude/ui";

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

/**
 * The toast auto-dismisses after this long by default. An outcome the buyer
 * must actually read (see the catch-all branch below) overrides it with
 * `duration: null` instead.
 */
export const PURCHASE_TOAST_DEFAULT_DURATION_MS = 6000;

export type PurchaseToast = {
  tone: ToastTone;
  key: string;
  /** Milliseconds before auto-dismiss, or `null` to stay until dismissed by hand. */
  duration: number | null;
};

/**
 * Translates `?purchase=` into a toast.
 *
 * The parameter is in the address bar, so a recruiter can put anything in it.
 * Everything that is not one of the four words `/api/billing/checkout-return`
 * writes lands on the same generic line — the raw value is NEVER rendered, both
 * because it would be meaningless to the reader and because a query string is
 * not a string this app should ever echo back onto the page.
 */
export function purchaseToastFor(value: string | null): PurchaseToast | null {
  if (!value) {
    return null;
  }

  // Every branch below shares the provider's default auto-dismiss; only the
  // catch-all overrides it with `duration: null` (see its own comment).
  const toast = (
    tone: ToastTone,
    key: string,
    duration: number | null = PURCHASE_TOAST_DEFAULT_DURATION_MS,
  ): PurchaseToast => ({ tone, key, duration });

  if (value === "granted" || value === "already") {
    // "already" means the webhook fulfilled the session before the browser came
    // back. The credits are there; the distinction is ours, not the buyer's.
    return toast("success", "settings.billing.credits.purchaseGranted");
  }

  if (value === "processing") {
    return toast("info", "settings.billing.credits.purchaseProcessing");
  }

  if (value === "cancelled") {
    return toast("info", "settings.billing.credits.purchaseCancelled");
  }

  if (value === "not_allowed") {
    // Named rather than collapsed into the generic line: this one IS actionable
    // ("ask an owner or admin"), and it reveals nothing the viewer does not
    // already know about their own role.
    return toast("warning", "settings.billing.credits.purchaseNotAllowed");
  }

  // The catch-all: an unrecognised value is a failed/unconfirmed purchase.
  // `duration: null` — unlike every branch above, this is not something the
  // buyer can shrug off if they miss it in 6 seconds; it stays on screen until
  // they dismiss it themselves.
  return toast("danger", "settings.billing.credits.purchaseFailed", null);
}

/**
 * The country-code half of amendment 22's US/EUR split (plan rule 4). US means
 * dollars; every other value — including CA, GB and CH, who Checkout still
 * quotes in euros — means euros. `undefined`/unrecognised values fall the same
 * way as "no signal", which is deliberately identical to the euro default.
 */
export function displayCurrencyForCountry(
  country: string | undefined,
): DisplayCurrency {
  return country?.toUpperCase() === "US" ? "USD" : "EUR";
}

/**
 * Amendment 22: US direct sales, so the buy surface must be able to quote
 * dollars. The default follows the browser's REGION, not its language — "en"
 * alone is as much Dublin as Denver, and the catalogue's default currency is the
 * euro. The recruiter can flip the toggle either way; Checkout then charges in
 * whatever currency Stripe resolves from their location, which is why this only
 * ever decides what is printed.
 *
 * Kept alongside `displayCurrencyForCountry` (its production caller is the
 * `Accept-Language` branch of `resolveDisplayCurrencyFromRequest` below) — the
 * old client-side `navigator.language` caller is gone (plan rule 4: the chain is
 * now resolved server-side, before first paint).
 */
export function defaultDisplayCurrency(
  locale: string | undefined,
): DisplayCurrency {
  return displayCurrencyForCountry(locale?.split("-")[1]);
}

/**
 * Plan rule 4's chain, minus the explicit user toggle (that part is client
 * state — see `settings-billing-section.tsx`): server-resolved request
 * geography, then EUR. Called once, in the settings loader, from the live
 * request's headers — never from `Organization.country` (rule 1's wall; a
 * declared jurisdiction hint is not a currency input and this function does not
 * even accept an organization).
 *
 * `x-vercel-ip-country` is Vercel's edge-resolved geo header and wins when
 * present. Local dev and non-Vercel hosts never see it, so the request's own
 * `Accept-Language` region is the fallback signal — still resolved before the
 * response is sent, so the server-rendered HTML already carries the right
 * symbol on first paint. No header at all, or an `Accept-Language` value that
 * parses to no recognisable region, ends where `defaultDisplayCurrency` always
 * did: EUR.
 *
 * Takes a `Headers`-shaped object rather than importing `next/headers` itself,
 * so this stays a plain function importable by the client component that also
 * imports `defaultDisplayCurrency` — the caller (`workspace-settings-data.ts`,
 * which has `"server-only"` at the top) is the one that actually calls Next's
 * `headers()`.
 */
export function resolveDisplayCurrencyFromRequest(
  headers: Pick<Headers, "get">,
): DisplayCurrency {
  const ipCountry = headers.get("x-vercel-ip-country");
  if (ipCountry) {
    return displayCurrencyForCountry(ipCountry);
  }

  // Each comma-separated entry may carry its own `;q=` quality value (RFC 9110
  // §12.5.4) — including the first one, with no comma in front of it — so that
  // has to be stripped before the region is readable at all: `"en-US;q=0.9"`
  // split only on "," would try to parse "US;q=0.9" as a region and silently
  // land on EUR.
  const acceptLanguage = headers.get("accept-language");
  const firstLocale = acceptLanguage
    ?.split(",")[0]
    ?.split(";")[0]
    ?.trim();

  return defaultDisplayCurrency(firstLocale);
}

/**
 * Plan rule 4's display-integrity gate: the USD toggle option may only be
 * offered when EVERY visible pack actually has a dollar price, so the ladder
 * can never end up printing a euro row next to a dollar row under a toggle that
 * claims "USD". An empty catalogue has nothing to confirm parity on, so it
 * reads as "cannot offer USD" rather than vacuously true.
 *
 * With this wired into the toggle (`settings-billing-section.tsx`), the
 * per-pack EUR fallback inside `creditPackAmountCents` below can no longer be
 * REACHED while `currency === "USD"` — the toggle cannot be in that state
 * unless every pack already has a dollar price. The fallback code stays for
 * defence in depth (and because `creditPackAmountCents` is also called with
 * `currency === "EUR"`, where the branch is irrelevant), not because it is
 * expected to fire.
 */
export function canOfferUsd(
  packs: Array<Pick<WorkspaceCreditPack, "unitAmountCentsUsd">>,
): boolean {
  return packs.length > 0 && packs.every((pack) => pack.unitAmountCentsUsd !== null);
}

/**
 * The amount to print for a pack, and the currency it is actually in. A pack
 * whose Stripe Price carries no USD `currency_options` entry has no dollar
 * amount to show, and inventing one by conversion would quote a price Checkout
 * would then contradict — so it falls back to the euro figure and says so.
 *
 * The mixed-ladder case this fallback exists for is now prevented upstream by
 * `canOfferUsd` (see above): the toggle cannot be switched to `"USD"` unless
 * every pack has a dollar price, so this branch cannot fire while the caller is
 * asking for USD.
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
