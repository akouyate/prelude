import { describe, expect, it } from "vitest";

import {
  billingStateDescriptionKey,
  canOfferUsd,
  creditPackAmountCents,
  defaultDisplayCurrency,
  formatCreditPrice,
  purchaseBannerFor,
  resolveDisplayCurrencyFromRequest,
  usagePercentage,
} from "./settings-billing-helpers";

describe("billing usage meter calculations", () => {
  it("uses the real finite limit and clamps over-limit usage", () => {
    expect(usagePercentage(25, 100)).toBe(25);
    expect(usagePercentage(125, 100)).toBe(100);
  });

  it("does not invent a percentage for an unlimited entitlement", () => {
    expect(usagePercentage(125, null)).toBeNull();
  });

  it("handles a zero limit without producing an invalid number", () => {
    expect(usagePercentage(0, 0)).toBe(0);
    expect(usagePercentage(1, 0)).toBe(100);
  });
});

describe("billing state copy", () => {
  it("explains states that change product access", () => {
    expect(billingStateDescriptionKey("canceled")).toBe(
      "settings.billing.canceledDescription",
    );
    expect(billingStateDescriptionKey("past_due")).toBe(
      "settings.billing.pastDueDescription",
    );
    expect(billingStateDescriptionKey("unavailable")).toBe(
      "settings.billing.unavailableDescription",
    );
    expect(billingStateDescriptionKey("active")).toBe(
      "settings.billing.description",
    );
  });
});

/**
 * The `?purchase=` banner. The route handler already collapsed fulfilment's
 * vocabulary into four words, and this is the second line of the same defence:
 * whatever ends up in the query string, the recruiter reads a translated
 * sentence, never a raw outcome token.
 */
describe("purchase outcome banner", () => {
  it("congratulates a granted purchase and a purchase the webhook already booked", () => {
    expect(purchaseBannerFor("granted")).toEqual({
      tone: "success",
      key: "settings.billing.credits.purchaseGranted",
    });
    expect(purchaseBannerFor("already")).toEqual({
      tone: "success",
      key: "settings.billing.credits.purchaseGranted",
    });
  });

  it("explains a deferred payment instead of calling it a failure", () => {
    expect(purchaseBannerFor("processing")).toEqual({
      tone: "info",
      key: "settings.billing.credits.purchaseProcessing",
    });
  });

  it("says nothing dramatic about a checkout the recruiter simply abandoned", () => {
    expect(purchaseBannerFor("cancelled")).toEqual({
      tone: "info",
      key: "settings.billing.credits.purchaseCancelled",
    });
  });

  it("names the permission refusal, because that one IS actionable", () => {
    expect(purchaseBannerFor("not_allowed")).toEqual({
      tone: "warning",
      key: "settings.billing.credits.purchaseNotAllowed",
    });
  });

  it("renders one generic line for anything else — never the token itself", () => {
    for (const value of ["error", "needs_admin", "foreign_session", "<script>", "42"]) {
      expect(purchaseBannerFor(value)).toEqual({
        tone: "warning",
        key: "settings.billing.credits.purchaseFailed",
      });
    }
  });

  it("shows no banner at all when the page was not reached from a checkout", () => {
    expect(purchaseBannerFor(null)).toBeNull();
    expect(purchaseBannerFor("")).toBeNull();
  });
});

/**
 * Amendment 22 — a light EUR/USD display toggle defaulting from the browser
 * locale. This only ever picks which cached amount to PRINT: Stripe Checkout
 * resolves the buyer's real currency from their location and remains the
 * authority on what is charged.
 */
describe("display currency", () => {
  it("defaults a US buyer to dollars and everyone else to euros", () => {
    expect(defaultDisplayCurrency("en-US")).toBe("USD");
    expect(defaultDisplayCurrency("es-US")).toBe("USD");
    expect(defaultDisplayCurrency("fr-FR")).toBe("EUR");
    expect(defaultDisplayCurrency("en-GB")).toBe("EUR");
    // A bare language says nothing about where the buyer is: "en" is as much
    // Dublin as Denver, and euros are the catalogue's default currency.
    expect(defaultDisplayCurrency("en")).toBe("EUR");
    expect(defaultDisplayCurrency(undefined)).toBe("EUR");
  });

  it("falls back to the euro amount for a pack Stripe has no dollar price for", () => {
    const pack = { id: "hiring_100", creditsGranted: 100, unitAmountCents: 34900, unitAmountCentsUsd: null };

    expect(creditPackAmountCents(pack, "USD")).toEqual({ amountCents: 34900, currency: "EUR" });
    expect(
      creditPackAmountCents({ ...pack, unitAmountCentsUsd: 37900 }, "USD"),
    ).toEqual({ amountCents: 37900, currency: "USD" });
    expect(
      creditPackAmountCents({ ...pack, unitAmountCentsUsd: 37900 }, "EUR"),
    ).toEqual({ amountCents: 34900, currency: "EUR" });
  });

  it("prints whole prices without stray cents", () => {
    // Intl separates the French amount from its symbol with a narrow no-break
    // space whose exact codepoint moves between ICU versions — normalised here so
    // the assertion is about the cents, not about Node's bundled ICU.
    const plain = (value: string) => value.replace(/\s/gu, " ");

    // The ladder is priced in round units; showing "349,00 €" adds noise no
    // recruiter needs on a button.
    expect(plain(formatCreditPrice(34900, "EUR", "fr-FR"))).toBe("349 €");
    expect(plain(formatCreditPrice(34900, "EUR", "en-US"))).toBe("€349");
    expect(plain(formatCreditPrice(37900, "USD", "en-US"))).toBe("$379");
  });
});

/**
 * Plan rule 4 — the display currency chain is now: explicit user toggle >
 * server-resolved request geography > EUR. This is the "request geography"
 * link: a pure function of the incoming request's headers, called from the
 * settings loader (never from the browser), so first paint already carries the
 * resolved symbol. It NEVER reads `Organization.country` — that field is not
 * even in scope here.
 */
describe("resolveDisplayCurrencyFromRequest", () => {
  it("trusts Vercel's edge geo header when present: US means dollars", () => {
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "x-vercel-ip-country": "US" }),
      ),
    ).toBe("USD");
  });

  it("treats any other geo header value as euros", () => {
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "x-vercel-ip-country": "FR" }),
      ),
    ).toBe("EUR");
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "x-vercel-ip-country": "GB" }),
      ),
    ).toBe("EUR");
  });

  it("is case-insensitive on the geo header's value", () => {
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "x-vercel-ip-country": "us" }),
      ),
    ).toBe("USD");
  });

  it("falls back to the Accept-Language region when there is no geo header (localhost, non-Vercel hosting)", () => {
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "accept-language": "en-US,en;q=0.9" }),
      ),
    ).toBe("USD");
  });

  it("reads euros from a non-US Accept-Language region, garbage, or a fully absent header", () => {
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "accept-language": "fr-FR,fr;q=0.9" }),
      ),
    ).toBe("EUR");
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "accept-language": "en-GB,en;q=0.9" }),
      ),
    ).toBe("EUR");
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "accept-language": "gibberish" }),
      ),
    ).toBe("EUR");
    expect(resolveDisplayCurrencyFromRequest(new Headers())).toBe("EUR");
  });

  it("is case-insensitive on the Accept-Language region too", () => {
    expect(
      resolveDisplayCurrencyFromRequest(
        new Headers({ "accept-language": "en-us,en;q=0.9" }),
      ),
    ).toBe("USD");
  });
});

/**
 * Plan rule 4's display-integrity pin: the toggle must never claim a currency
 * the ladder is not actually showing. `creditPackAmountCents` falls back to the
 * euro figure per-pack, so a USD toggle over a catalogue with a partial dollar
 * price list would silently mix € and $ rows — this is the guard that keeps the
 * toggle from ever being switched into that state.
 */
describe("canOfferUsd", () => {
  it("offers USD only when every visible pack has a dollar price", () => {
    expect(
      canOfferUsd([
        { unitAmountCentsUsd: 9900 },
        { unitAmountCentsUsd: 37900 },
      ]),
    ).toBe(true);
  });

  it("refuses USD the moment a single pack has none", () => {
    expect(
      canOfferUsd([
        { unitAmountCentsUsd: 9900 },
        { unitAmountCentsUsd: null },
      ]),
    ).toBe(false);
  });

  it("refuses USD for an empty ladder — there is nothing to confirm parity on", () => {
    expect(canOfferUsd([])).toBe(false);
  });
});
