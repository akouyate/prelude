import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prelude/db";

import {
  createCreditCheckoutSession,
  ensureStripeCustomer,
  MissingCheckoutSessionUrlError,
  UnsupportedCreditCurrencyError,
} from "./stripe-purchase";

const now = new Date("2026-08-15T09:00:00.000Z");

type WalletRow = { id: string; organizationId: string; stripeCustomerId: string | null };

type PackRow = {
  id: string;
  creditsGranted: number;
  unitAmountCents: number;
  unitAmountCentsUsd: number | null;
  currency: string;
  stripeProductId: string | null;
  stripePriceId: string | null;
  enabled: boolean;
  visibility: string;
};

function pack(overrides: Partial<PackRow> = {}): PackRow {
  return {
    id: "hiring_100",
    creditsGranted: 100,
    unitAmountCents: 34900,
    // Deliberately not the EUR numeral (the real catalogue mirrors them): a swap
    // between the two cached amounts has to fail a test.
    unitAmountCentsUsd: 37900,
    currency: "EUR",
    stripeProductId: "prod_hiring",
    stripePriceId: "price_hiring",
    enabled: true,
    visibility: "public",
    ...overrides,
  };
}

/**
 * Enough Prisma surface for these two functions: `ensureWallet` short-circuits on
 * an existing wallet, so no transaction is ever entered here (wallet creation is
 * covered by the Phase 1 database suite).
 */
function fakeDb(options: { wallet?: Partial<WalletRow>; packs?: PackRow[] } = {}) {
  const wallet: WalletRow = {
    id: "wal_1",
    organizationId: "org_1",
    stripeCustomerId: null,
    ...options.wallet,
  };
  const packs = new Map((options.packs ?? [pack()]).map((row) => [row.id, row]));

  const readWallet = (where: { id?: string; organizationId?: string }) =>
    where.id === wallet.id || where.organizationId === wallet.organizationId ? { ...wallet } : null;

  const db = {
    creditWallet: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; organizationId?: string } }) =>
        readWallet(where),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id?: string; organizationId?: string } }) => {
        const row = readWallet(where);
        if (!row) throw new Error("wallet not found");
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { stripeCustomerId: string } }) => {
          if (where.id !== wallet.id) throw new Error("wallet not found");
          wallet.stripeCustomerId = data.stripeCustomerId;
          return { ...wallet };
        },
      ),
    },
    creditPack: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = packs.get(where.id);
        return row ? { ...row } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { stripePriceId: string; unitAmountCents: number; unitAmountCentsUsd: number | null };
        }) => {
          const row = packs.get(where.id);
          if (!row) throw new Error("pack not found");
          Object.assign(row, data);
          return { ...row };
        },
      ),
    },
  };

  return { db: db as unknown as PrismaClient, spies: db, wallet: () => ({ ...wallet }) };
}

type ListedPrice = {
  id: string;
  created: number;
  metadata: Record<string, string>;
  unit_amount: number | null;
  currency_options?: { [key: string]: { unit_amount: number | null } };
};

function fakeStripe(
  overrides: {
    price?: { id: string; active: boolean; product: string };
    listed?: ListedPrice[];
    sessionUrl?: string | null;
  } = {},
) {
  return {
    customers: { create: vi.fn().mockResolvedValue({ id: "cus_1" }) },
    prices: {
      retrieve: vi
        .fn()
        .mockResolvedValue(overrides.price ?? { id: "price_hiring", active: true, product: "prod_hiring" }),
      // Honest about the API: Stripe omits `currency_options` unless the caller
      // expands it, so a reader that forgets the expand must see nothing here.
      list: vi.fn(async (params: { expand?: string[] }) => ({
        data: (overrides.listed ?? []).map((price) => {
          if (params.expand?.includes("data.currency_options")) return price;
          const { currency_options: _unexpanded, ...withoutOptions } = price;
          return withoutOptions;
        }),
      })),
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "cs_1",
          url: overrides.sessionUrl === undefined ? "https://checkout.stripe.test/cs_1" : overrides.sessionUrl,
        }),
      },
    },
  };
}

function checkoutInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org_1",
    organizationName: "Acme",
    packId: "hiring_100",
    origin: "http://localhost:3000",
    now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
});

afterEach(() => vi.unstubAllEnvs());

describe("ensureStripeCustomer", () => {
  it("creates the customer once with the organization as idempotency key and stores it on the wallet", async () => {
    const { db, spies, wallet } = fakeDb();
    const stripe = fakeStripe();

    const result = await ensureStripeCustomer(db, {
      organizationId: "org_1",
      organizationName: "Acme",
      now,
      stripe,
    });

    expect(result).toEqual({ stripeCustomerId: "cus_1" });
    expect(stripe.customers.create).toHaveBeenCalledWith(
      { name: "Acme", metadata: { organizationId: "org_1" } },
      { idempotencyKey: "customer:org_1" },
    );
    expect(spies.creditWallet.update).toHaveBeenCalledWith({
      where: { id: "wal_1" },
      data: { stripeCustomerId: "cus_1" },
    });
    expect(wallet().stripeCustomerId).toBe("cus_1");
  });

  it("reuses the stored customer and never calls Stripe a second time", async () => {
    const { db, spies } = fakeDb();
    const stripe = fakeStripe();

    await ensureStripeCustomer(db, { organizationId: "org_1", organizationName: "Acme", now, stripe });
    const second = await ensureStripeCustomer(db, {
      organizationId: "org_1",
      organizationName: "Acme",
      now,
      stripe,
    });

    expect(second).toEqual({ stripeCustomerId: "cus_1" });
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(spies.creditWallet.update).toHaveBeenCalledTimes(1);
  });
});

describe("createCreditCheckoutSession", () => {
  it("refuses to sell while the credit kill switch is off", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "0");
    const { db } = fakeDb();
    const stripe = fakeStripe();

    expect(await createCreditCheckoutSession(db, { ...checkoutInput(), stripe })).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("refuses to sell without a Stripe secret key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { db } = fakeDb();
    const stripe = fakeStripe();

    expect(await createCreditCheckoutSession(db, { ...checkoutInput(), stripe })).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("builds a Checkout session with tax, tax-id collection, invoicing and server-owned metadata", async () => {
    const { db, spies } = fakeDb();
    const stripe = fakeStripe();

    const result = await createCreditCheckoutSession(db, { ...checkoutInput(), stripe });

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_1" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "payment",
      customer: "cus_1",
      line_items: [{ price: "price_hiring", quantity: 1 }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      // Amendment 15 — the expiry travels on the invoice the customer keeps, not
      // just on a screen they saw once. 2026-08-15 + 365 days.
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description:
            "100 HireCall interview credits — valid until 2027-08-15 (12 months from the purchase date).",
        },
      },
      customer_update: { address: "auto" },
      client_reference_id: "org_1",
      metadata: {
        organizationId: "org_1",
        packId: "hiring_100",
        credits: "100",
        amountCents: "34900",
        amountCentsUsd: "37900",
      },
      // Amendment 6 — the return lands on a route handler that re-authenticates
      // the caller and refuses a session belonging to another organization. It
      // must NOT land on a page that would fulfil whatever `cs_…` the URL carries.
      success_url: "http://localhost:3000/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:3000/settings?view=billing&purchase=cancelled",
    });
    // Happy path: the stored price is verified once, never re-resolved or rewritten.
    expect(stripe.prices.retrieve).toHaveBeenCalledWith("price_hiring");
    expect(stripe.prices.list).not.toHaveBeenCalled();
    expect(spies.creditPack.update).not.toHaveBeenCalled();
  });

  it("re-resolves the price and refreshes the cached amounts when another sync deactivated the stored one", async () => {
    const { db, spies } = fakeDb();
    const stripe = fakeStripe({
      price: { id: "price_hiring", active: false, product: "prod_hiring" },
      listed: [
        { id: "price_other_pack", created: 300, metadata: { packId: "scale_500" }, unit_amount: 149000 },
        // Mid-rotation the product can carry two active prices for the same pack.
        // The older one comes first in the list so a plain `find` would pick it.
        {
          id: "price_hiring_v1_bis",
          created: 100,
          metadata: { packId: "hiring_100" },
          unit_amount: 34900,
          currency_options: { usd: { unit_amount: 37900 } },
        },
        {
          id: "price_hiring_v2",
          created: 200,
          metadata: { packId: "hiring_100" },
          unit_amount: 39900,
          currency_options: { usd: { unit_amount: 42900 } },
        },
      ],
    });

    const result = await createCreditCheckoutSession(db, { ...checkoutInput(), stripe });

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_1" });
    // `currency_options` is absent from the response unless it is expanded — without
    // this parameter the USD refresh below silently reads nothing.
    expect(stripe.prices.list).toHaveBeenCalledWith({
      product: "prod_hiring",
      active: true,
      limit: 100,
      expand: ["data.currency_options"],
    });
    // Stripe just confirmed what the pack costs: the cache follows it, and the
    // metadata Task 5 cross-checks carries those refreshed amounts, not the stale ones.
    expect(spies.creditPack.update).toHaveBeenCalledWith({
      where: { id: "hiring_100" },
      data: { stripePriceId: "price_hiring_v2", unitAmountCents: 39900, unitAmountCentsUsd: 42900 },
    });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_hiring_v2", quantity: 1 }],
        metadata: {
          organizationId: "org_1",
          packId: "hiring_100",
          credits: "100",
          amountCents: "39900",
          amountCentsUsd: "42900",
        },
      }),
    );
  });

  it("keeps the cached amounts when the re-resolved price reports none", async () => {
    const { db, spies } = fakeDb();
    const stripe = fakeStripe({
      price: { id: "price_hiring", active: false, product: "prod_hiring" },
      listed: [{ id: "price_hiring_v2", created: 100, metadata: { packId: "hiring_100" }, unit_amount: null }],
    });

    await createCreditCheckoutSession(db, { ...checkoutInput(), stripe });

    expect(spies.creditPack.update).toHaveBeenCalledWith({
      where: { id: "hiring_100" },
      data: { stripePriceId: "price_hiring_v2", unitAmountCents: 34900, unitAmountCentsUsd: 37900 },
    });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ amountCents: "34900", amountCentsUsd: "37900" }),
      }),
    );
  });

  it("refuses the pack when the rotation left no active price for it", async () => {
    const { db, spies } = fakeDb();
    const stripe = fakeStripe({
      price: { id: "price_hiring", active: false, product: "prod_hiring" },
      listed: [{ id: "price_other_pack", created: 100, metadata: { packId: "scale_500" }, unit_amount: 149000 }],
    });

    expect(await createCreditCheckoutSession(db, { ...checkoutInput(), stripe })).toEqual({
      ok: false,
      error: "pack_not_purchasable",
    });
    expect(spies.creditPack.update).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("refuses unknown packs, disabled packs, and packs with no Stripe price", async () => {
    const stripe = fakeStripe();

    const unknown = fakeDb();
    expect(
      await createCreditCheckoutSession(unknown.db, { ...checkoutInput({ packId: "nope_1" }), stripe }),
    ).toEqual({ ok: false, error: "unknown_pack" });

    const disabled = fakeDb({ packs: [pack({ enabled: false })] });
    expect(await createCreditCheckoutSession(disabled.db, { ...checkoutInput(), stripe })).toEqual({
      ok: false,
      error: "pack_not_purchasable",
    });

    const unpriced = fakeDb({ packs: [pack({ stripePriceId: null })] });
    expect(await createCreditCheckoutSession(unpriced.db, { ...checkoutInput(), stripe })).toEqual({
      ok: false,
      error: "pack_not_purchasable",
    });

    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("sells a quiet pack — visibility only controls listing", async () => {
    const { db } = fakeDb({
      packs: [
        pack({
          id: "volume_1000",
          visibility: "quiet",
          creditsGranted: 1000,
          unitAmountCents: 279000,
          unitAmountCentsUsd: 289000,
        }),
      ],
    });
    const stripe = fakeStripe();

    const result = await createCreditCheckoutSession(db, {
      ...checkoutInput({ packId: "volume_1000" }),
      stripe,
    });

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_1" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          organizationId: "org_1",
          packId: "volume_1000",
          credits: "1000",
          amountCents: "279000",
          amountCentsUsd: "289000",
        },
      }),
    );
  });

  it("omits the USD amount from the metadata when the pack has none", async () => {
    const { db } = fakeDb({ packs: [pack({ unitAmountCentsUsd: null })] });
    const stripe = fakeStripe();

    await createCreditCheckoutSession(db, { ...checkoutInput(), stripe });

    // Exact object: an `amountCentsUsd` key here would make Task 5's
    // currency-aware check compare a USD payment against a phantom amount.
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          organizationId: "org_1",
          packId: "hiring_100",
          credits: "100",
          amountCents: "34900",
        },
      }),
    );
  });

  it("sells a USD pack and refuses any currency outside the closed EUR/USD set", async () => {
    const usd = fakeDb({ packs: [pack({ currency: "usd" })] });
    const stripe = fakeStripe();

    expect(await createCreditCheckoutSession(usd.db, { ...checkoutInput(), stripe })).toEqual({
      ok: true,
      url: "https://checkout.stripe.test/cs_1",
    });
    // Checkout resolves the buyer's currency from the Price's currency_options —
    // the session itself never carries one.
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ currency: expect.anything() }),
    );

    const gbp = fakeDb({ packs: [pack({ currency: "GBP" })] });
    await expect(
      createCreditCheckoutSession(gbp.db, { ...checkoutInput(), stripe }),
    ).rejects.toBeInstanceOf(UnsupportedCreditCurrencyError);
  });

  it("refuses to hand back a session without a redirect URL", async () => {
    const { db } = fakeDb();
    const stripe = fakeStripe({ sessionUrl: null });

    await expect(
      createCreditCheckoutSession(db, { ...checkoutInput(), stripe }),
    ).rejects.toBeInstanceOf(MissingCheckoutSessionUrlError);
  });

  it("tolerates a trailing slash on the console origin", async () => {
    const { db } = fakeDb();
    const stripe = fakeStripe();

    await createCreditCheckoutSession(db, {
      ...checkoutInput({ origin: "https://app.hirecall.test/" }),
      stripe,
    });

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          "https://app.hirecall.test/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.hirecall.test/settings?view=billing&purchase=cancelled",
      }),
    );
  });

  it("states the credits and their expiry date on the invoice the customer keeps", async () => {
    const { db } = fakeDb({
      packs: [pack({ id: "volume_1000", creditsGranted: 1000, visibility: "quiet" })],
    });
    const stripe = fakeStripe();

    await createCreditCheckoutSession(db, {
      ...checkoutInput({ packId: "volume_1000", now: new Date("2026-12-31T23:00:00.000Z") }),
      stripe,
    });

    // The date is the lot's real `expiresAt` (purchase + PAID_CREDIT_EXPIRY_DAYS),
    // computed from the same constant the ledger uses — not a hand-written "+1 year".
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_creation: {
          enabled: true,
          invoice_data: {
            description:
              "1000 HireCall interview credits — valid until 2027-12-31 (12 months from the purchase date).",
          },
        },
      }),
    );
  });
});
