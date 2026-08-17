import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import { grantPurchasedCreditLot, type GrantPurchasedCreditLotInput } from "./credit-ledger";
import { getStripeClient } from "./stripe-client";

/**
 * The slice of the Stripe SDK this module touches. Same discipline as
 * `StripePurchaseClient`: a structural port the real client satisfies as-is, so
 * the tests inject a fake without casting a whole `Stripe` instance.
 *
 * Two deliberate departures from the SDK's own types:
 * - `payment_intent` / `invoice` keep BOTH shapes. They are expandable fields:
 *   Stripe returns a bare id unless the request expands them, never expands
 *   anything inside a webhook payload, and types them `string | Object | null`
 *   whatever we ask for. The reader below therefore narrows both, always.
 * - `metadata` values are `string | undefined`. Stripe's `Metadata` index
 *   signature promises `string` for every key, which is only true of keys that
 *   were actually set — and "was this key set at all?" is precisely a question
 *   fulfilment has to answer (amendment 22's absent `amountCentsUsd`).
 */
export type StripeFulfilmentClient = {
  checkout: {
    sessions: {
      retrieve(
        id: string,
        params?: Stripe.Checkout.SessionRetrieveParams,
        options?: Stripe.RequestOptions,
      ): Promise<{
        id: string;
        payment_status: string;
        currency: string | null;
        amount_subtotal: number | null;
        metadata: { [key: string]: string | undefined } | null;
        payment_intent: string | { id: string } | null;
        invoice: string | { id: string } | null;
      }>;
    };
  };
};

/**
 * Every way a paid Checkout session can end.
 *
 * `unknown_pack`, `amount_mismatch` and `needs_admin` all mean the same
 * operational thing — money arrived and this code refuses to turn it into
 * credits — and Task 6 maps the three onto the archive's `needs_admin` status.
 * They stay distinct here because the three call for different human actions:
 * fix the catalogue, investigate a price divergence, investigate a session we
 * may not have created.
 *
 * `foreign_session` is the odd one out: it is not a verdict about the money at
 * all, only about the *caller* (amendment 6). It can only be reached by a caller
 * that passed an `expectedOrganizationId`, i.e. the browser return, and it says
 * "this session is not yours" without saying anything more.
 */
export type CreditCheckoutFulfilment =
  | { outcome: "granted"; lotId: string }
  | { outcome: "already_granted" }
  | { outcome: "not_paid" }
  | { outcome: "unknown_pack" }
  | { outcome: "no_payment_intent" }
  | { outcome: "amount_mismatch" }
  | { outcome: "foreign_session" }
  | { outcome: "needs_admin"; reason: "missing_metadata" | "no_payment_required" };

/** Currencies a lot can be denominated in — amendment 22, lower-cased as Stripe reports them. */
const FULFILLABLE_CURRENCIES = ["eur", "usd"] as const;
type FulfillableCurrency = (typeof FULFILLABLE_CURRENCIES)[number];

/** Which metadata key carries the expected subtotal for each currency Checkout may settle in. */
const EXPECTED_AMOUNT_METADATA_KEY: Record<FulfillableCurrency, string> = {
  eur: "amountCents",
  usd: "amountCentsUsd",
};

/**
 * The grant core: one settled payment intent becomes one paid lot.
 *
 * Deliberately thin — `grantPurchasedCreditLot` already owns idempotence, the
 * positivity guard and the cross-organization guard, and none of that is worth
 * re-litigating one layer up. What this function buys is a *name for the
 * boundary*: Phase 3's off-session top-up charges a stored mandate and has no
 * Checkout session to retrieve, so it calls this instead of the Checkout adapter
 * below. It is also the single place where a future "everything a paid payment
 * must trigger" step (receipt, analytics) lands without touching either caller.
 */
export async function fulfillPaidPaymentIntent(
  db: PrismaClient,
  input: GrantPurchasedCreditLotInput,
): Promise<{ outcome: "granted"; lotId: string } | { outcome: "already_granted" }> {
  return grantPurchasedCreditLot(db, input);
}

/**
 * The Checkout adapter: the single function through which a paid Checkout session
 * becomes credits, called by the webhook dispatcher, the browser return and the
 * missed-event sweep alike. Every one of them may call it for the same session,
 * more than once — the ledger's `stripePaymentIntentId @unique` is what makes
 * that safe, not the callers' discipline.
 *
 * Nothing here trusts its caller: the session id is the only input, and the
 * session is re-read from Stripe before anything is decided. `amount_subtotal`
 * (excluding tax) is the figure compared against the metadata written at session
 * creation — `amount_total` carries Stripe Tax and would never match.
 *
 * The guard order is: is this session the caller's at all? → did it collect a
 * payment? → is this session ours? → does the pack exist and grant something? →
 * does the money agree? → can we identify the payment? Each step is a refusal to
 * grant, and a refusal never writes anything.
 *
 * `expectedOrganizationId` is the caller-ownership guard (amendment 6). Only the
 * browser-return route passes it, because only it takes the session id from a
 * query string: a `cs_…` a recruiter can edit must not fulfil, or even report on,
 * another organization's checkout. The webhook and the sweep omit it — they are
 * authenticated by Stripe's signature and are legitimately allowed to fulfil for
 * any organization. Keeping the check here rather than in the route is deliberate:
 * it lives inside the money boundary, where it cannot be forgotten by a future
 * caller.
 */
export async function fulfillCreditCheckout(
  db: PrismaClient,
  input: {
    checkoutSessionId: string;
    expectedOrganizationId?: string;
    stripeEventId?: string;
    now: Date;
    stripe?: StripeFulfilmentClient;
  },
): Promise<CreditCheckoutFulfilment> {
  const {
    checkoutSessionId,
    expectedOrganizationId,
    stripeEventId,
    now,
    stripe = getStripeClient(),
  } = input;

  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
    expand: ["payment_intent", "invoice"],
  });

  // FIRST, before any other verdict. Every later branch returns a different
  // outcome for a different session state, so running any of them on a session
  // the caller does not own turns this function into an enumeration oracle: feed
  // it `cs_…` ids and read other organizations' checkout state off the answers.
  // One indistinguishable `foreign_session` for "not yours", whatever the reason
  // — including metadata we cannot attribute at all, which for an authenticated
  // browser caller is simply "not yours" rather than a queue for a human.
  if (expectedOrganizationId !== undefined) {
    if (session.metadata?.organizationId?.trim() !== expectedOrganizationId) {
      console.error("[stripe-fulfilment] refused a checkout session the caller does not own", {
        checkoutSessionId: session.id,
        expectedOrganizationId,
      });
      return { outcome: "foreign_session" };
    }
  }

  // A Checkout session completes before the funds land on deferred methods (SEPA
  // debit, bank transfers): Stripe calls us again with
  // `checkout.session.async_payment_succeeded` once they do, so `unpaid` is a
  // "not yet", not a problem.
  if (session.payment_status === "unpaid") {
    return { outcome: "not_paid" };
  }

  // Everything else must be `paid` before a single credit moves, and the amount
  // cross-check below CANNOT stand in for this guard: `amount_subtotal` is the
  // total *before* discounts (SDK: "Total of all items before discounts or taxes
  // are applied"), so a 100%-discounted session matches the metadata to the cent
  // while `amount_total` is zero and nothing was ever collected. A session that
  // collected nothing never grants automatically, whatever its metadata says —
  // and an unrecognised status (Stripe types this field open-ended) parks here
  // too rather than being read as a payment.
  if (session.payment_status !== "paid") {
    console.error("[stripe-fulfilment] session completed without collecting a payment", {
      checkoutSessionId: session.id,
      paymentStatus: session.payment_status,
      stripeEventId,
    });
    return { outcome: "needs_admin", reason: "no_payment_required" };
  }

  const metadata = session.metadata ?? {};
  const organizationId = metadata.organizationId?.trim();
  const packId = metadata.packId?.trim();
  // Both keys are server-written at session creation and never read back from the
  // browser. Either one missing means this session's metadata is not the contract
  // this code was built on — a session created outside our checkout, or one whose
  // metadata was stripped. Guessing an owner for the money is not an option, and
  // an undefined `packId` cannot even be handed to Prisma.
  if (!organizationId || !packId) {
    console.error("[stripe-fulfilment] paid session without usable metadata", {
      checkoutSessionId: session.id,
      stripeEventId,
    });
    return { outcome: "needs_admin", reason: "missing_metadata" };
  }

  // The `creditsGranted` floor closes a corrupt-catalogue path, not a customer
  // one: a row promising zero credits would sail past the cross-check below
  // (metadata written from that same row agrees with it), hit the ledger's
  // positivity guard, throw, archive `failed` and have Stripe retry a payment
  // that can never succeed. Parking it is the only terminal answer.
  const pack = await db.creditPack.findUnique({ where: { id: packId } });
  if (!pack || !pack.enabled || pack.creditsGranted <= 0) {
    console.error("[stripe-fulfilment] paid session for a pack we cannot map", {
      checkoutSessionId: session.id,
      organizationId,
      packId,
      disabled: Boolean(pack),
      creditsGranted: pack?.creditsGranted ?? null,
    });
    return { outcome: "unknown_pack" };
  }

  // Cross-check 1 — credits. The catalogue is the authority on how many credits a
  // pack is worth; the metadata is a snapshot of what it said when the session was
  // created. A divergence means the pack changed mid-checkout, and neither number
  // can be trusted to be the one the customer agreed to.
  if (Number(metadata.credits) !== pack.creditsGranted) {
    console.error("[stripe-fulfilment] credits diverged between session and catalogue", {
      checkoutSessionId: session.id,
      organizationId,
      packId,
      metadataCredits: metadata.credits,
      catalogueCredits: pack.creditsGranted,
    });
    return { outcome: "amount_mismatch" };
  }

  // Cross-check 2 — money, in the currency Checkout actually settled in. Stripe,
  // not this code, picks the buyer's currency from their location (amendment 22),
  // so the expected amount comes from whichever metadata key matches: a USD
  // session compared against the EUR figure would read every US purchase as
  // fraud. An absent key is a mismatch, never a fallback to the other currency.
  const expected = resolveExpectedPayment(session.currency, metadata);
  const paidAmountCents = session.amount_subtotal;
  if (expected === null || paidAmountCents === null || paidAmountCents !== expected.amountCents) {
    console.error("[stripe-fulfilment] amount diverged between session and metadata", {
      checkoutSessionId: session.id,
      organizationId,
      packId,
      currency: session.currency,
      paidAmountCents,
      expectedAmountCents: expected?.amountCents ?? null,
    });
    return { outcome: "amount_mismatch" };
  }

  const stripePaymentIntentId = idOf(session.payment_intent);
  if (!stripePaymentIntentId) {
    console.error("[stripe-fulfilment] paid session without a payment intent", {
      checkoutSessionId: session.id,
      organizationId,
      packId,
    });
    return { outcome: "no_payment_intent" };
  }

  // What the lot records: the credits are ours (the catalogue's), the money is
  // Stripe's (what was actually charged, in the currency it was charged in). A
  // price rotation between session creation and fulfilment must not rewrite
  // history, and a USD purchase must never be filed as EUR (amendments 3 + 22).
  return fulfillPaidPaymentIntent(db, {
    organizationId,
    packId: pack.id,
    creditsGranted: pack.creditsGranted,
    unitAmountCents: paidAmountCents,
    currency: expected.currency,
    stripePaymentIntentId,
    stripeCheckoutSessionId: session.id,
    stripeInvoiceId: idOf(session.invoice),
    stripeEventId,
    now,
  });
}

/**
 * The subtotal this session should have carried, or `null` when there is nothing
 * to compare against — an unsupported currency, or a currency we sell in whose
 * amount the session metadata never carried.
 */
function resolveExpectedPayment(
  currency: string | null,
  metadata: { [key: string]: string | undefined },
): { currency: FulfillableCurrency; amountCents: number } | null {
  // Stripe reports currencies lower-cased; an exact match is the point, since
  // anything else is a currency this pipeline cannot account for.
  const settled = FULFILLABLE_CURRENCIES.find((supported) => supported === currency);
  if (!settled) {
    return null;
  }

  const raw = metadata[EXPECTED_AMOUNT_METADATA_KEY[settled]];
  if (raw === undefined || raw.trim() === "") {
    return null;
  }

  return { currency: settled, amountCents: Number(raw) };
}

/** Expandable fields arrive as an id or as the object; `undefined` keeps optional inputs absent. */
function idOf(field: string | { id: string } | null): string | undefined {
  if (field === null) return undefined;
  return typeof field === "string" ? field : field.id;
}
