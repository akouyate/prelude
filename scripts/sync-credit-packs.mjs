#!/usr/bin/env node

// Upserts the #139 pack ladder locally, and — when STRIPE_SECRET_KEY is set —
// ensures each pack has a Stripe Product and an active Price with
// tax_behavior=exclusive (immutable once set) and a USD currency_options
// mirror (amendment 22). A price change is a NEW Price: pass
// PACK_PRICE_OVERRIDES='{"hiring_100":{"eur":39900,"usd":39900}}' to rotate
// — both currencies must be given together (amendment 22: the script
// "creates/rotates Prices with both options"; a EUR-only override would
// mint a mispriced pair, silently leaving USD stale). The old Price is
// deactivated, past lots keep the amount they were bought at.
//
// The local price cache (unitAmountCents / unitAmountCentsUsd) follows
// Stripe, never leads it (amendment 2): those columns are only written
// inside the Stripe-confirmed branch below, using the amount Stripe's API
// actually returned. A keyless run seeds them from the PACKS constant on
// first insert only (so a fresh dev environment is still displayable) and
// never touches them again — an UPDATE in keyless mode leaves the cached
// amounts untouched. Running with PACK_PRICE_OVERRIDES but no
// STRIPE_SECRET_KEY is refused outright: without Stripe there is nothing to
// confirm the override against.
//
// Price rotation tolerates another dev having rotated first (amendment 12):
// the "is this price still correct" check reads Stripe's current active
// Price for the product, not the local cache, so two independent runs that
// want the same amount converge on the same Price instead of racing to
// create duplicates. Product creation carries an Idempotency-Key derived
// from the packId, and falls back to a metadata[packId] lookup, so a crash
// between product and price creation can't duplicate Products on rerun.
import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { PrismaClient } = requireFromDbPackage("@prisma/client");

// Every Product carries a tax code. Without one, Stripe refuses the Checkout
// session outright — "Invalid line_items[0]: the product tax code is missing" —
// so this is not a tax nicety, it is what makes the pack purchasable at all.
//
// `txcd_10103001` = "Software as a service (SaaS) - business use", verified
// against the live `GET /v1/tax_codes` list (673 codes) rather than copied from
// memory. The "business use" variant, not the personal one, because the B2B-only
// clause in the ToS is load-bearing for this product (amendment 22's legal
// posture) — the credits are only ever sold to companies.
//
// Stripe Tax maps this code to the right treatment per jurisdiction: an
// electronically supplied service for EU VAT, and the state-by-state SaaS rules
// in the US. Changing it is a tax decision, not a refactor.
const PRODUCT_TAX_CODE = "txcd_10103001";

// USD working values mirror the EUR numerals ($99 / $349 / $1,490 / $2,790)
// — same "subject to validation" status as the EUR ladder (amendment 22).
const PACKS = [
  {
    id: "starter_25",
    creditsGranted: 25,
    unitAmountCents: 9900,
    unitAmountCentsUsd: 9900,
    visibility: "public",
    displayOrder: 1,
  },
  {
    id: "hiring_100",
    creditsGranted: 100,
    unitAmountCents: 34900,
    unitAmountCentsUsd: 34900,
    visibility: "public",
    displayOrder: 2,
  },
  {
    id: "scale_500",
    creditsGranted: 500,
    unitAmountCents: 149000,
    unitAmountCentsUsd: 149000,
    visibility: "public",
    displayOrder: 3,
  },
  {
    id: "volume_1000",
    creditsGranted: 1000,
    unitAmountCents: 279000,
    unitAmountCentsUsd: 279000,
    visibility: "quiet",
    displayOrder: 4,
  },
];

const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const overridesRaw = process.env.PACK_PRICE_OVERRIDES;

// Amendment 22: a rotation always carries both currencies. The old flat
// `{"packId": <eurCents>}` shape left USD silently pinned to the static
// mirror while EUR moved, minting a mispriced pair — refuse it outright
// and name the new shape rather than guess a USD amount.
//
// Two shapes of nonsense fail loudly rather than no-op, on the same
// discipline: an override that does not name a real pack, and an override
// that is not an object of packs at all. Both used to end in a full sync at
// the UNCHANGED prices with a zero exit code — the one outcome an operator
// rotating a price will not check for, because the script said it worked.
function validateOverrides(rawOverrides) {
  // `null` would throw a raw TypeError out of `Object.entries`, and `[]` / `42`
  // would iterate to nothing and pass for "no overrides" — a silent
  // no-op where an operator asked for a price change.
  if (typeof rawOverrides !== "object" || rawOverrides === null || Array.isArray(rawOverrides)) {
    fail(
      `PACK_PRICE_OVERRIDES must be a JSON object keyed by pack id: ` +
        `{"hiring_100":{"eur":<cents>,"usd":<cents>}}. Got: ` +
        `${JSON.stringify(rawOverrides)}.`,
    );
  }

  const knownPackIds = PACKS.map((pack) => pack.id);
  const validated = {};
  for (const [packId, value] of Object.entries(rawOverrides)) {
    // A typo'd or retired pack id used to be a silent no-op: `overrides[pack.id]`
    // never matched, every pack synced at its unchanged price, and the run exited
    // 0. Amendment 2's discipline is that a price the operator asked to move and
    // that did not move is a failure, not a shrug.
    if (!knownPackIds.includes(packId)) {
      fail(
        `PACK_PRICE_OVERRIDES names an unknown pack id "${packId}". ` +
          `Known packs: ${knownPackIds.join(", ")}.`,
      );
    }
    if (typeof value === "number") {
      fail(
        `PACK_PRICE_OVERRIDES["${packId}"] uses the old flat-number format ` +
          `(${value}, EUR-only). Both currencies must rotate together — use ` +
          `the new shape: {"${packId}":{"eur":<cents>,"usd":<cents>}}.`,
      );
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      fail(
        `PACK_PRICE_OVERRIDES["${packId}"] must be an object with both ` +
          `currencies: {"${packId}":{"eur":<cents>,"usd":<cents>}}. Got: ` +
          `${JSON.stringify(value)}.`,
      );
    }
    const missingLegs = ["eur", "usd"].filter((leg) => !Number.isInteger(value[leg]));
    if (missingLegs.length > 0) {
      fail(
        `PACK_PRICE_OVERRIDES["${packId}"] is missing the ${missingLegs.join(" and ")} ` +
          `leg. Both currencies must be provided together: ` +
          `{"${packId}":{"eur":<cents>,"usd":<cents>}}.`,
      );
    }
    validated[packId] = { eur: value.eur, usd: value.usd };
  }
  return validated;
}

let overrides = {};
if (overridesRaw) {
  let parsedOverrides;
  try {
    parsedOverrides = JSON.parse(overridesRaw);
  } catch (error) {
    fail(`PACK_PRICE_OVERRIDES is not valid JSON: ${error.message}`);
  }
  overrides = validateOverrides(parsedOverrides);
}
const hasOverrides = Object.keys(overrides).length > 0;

// Amendment 2: the script FAILS (non-zero exit) if an override is supplied
// without a Stripe key — there is no Stripe to confirm the new price
// against, and the local cache must never lead Stripe.
if (hasOverrides && !stripeKey) {
  fail(
    "PACK_PRICE_OVERRIDES is set but STRIPE_SECRET_KEY is not. Refusing to " +
      "run: a price override with no Stripe key would have nothing to " +
      "confirm the new amount against. Unset PACK_PRICE_OVERRIDES or " +
      "provide STRIPE_SECRET_KEY.",
  );
}

async function stripeCall(path, params, { method = "POST", idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${stripeKey}` };
  let url = `https://api.stripe.com/v1/${path}`;
  let body;
  if (method === "GET") {
    const query = new URLSearchParams(params).toString();
    url += query ? `?${query}` : "";
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(params);
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  }
  const response = await fetch(url, { method, headers, body });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`stripe ${method} ${path}: ${json.error?.message ?? response.status}`);
  }
  return json;
}

// Amendment 2 fallback half: look up an existing Product by metadata.packId
// before creating one, so a rerun on a machine with an empty local cache
// (or a colleague's clone) adopts the existing Product instead of making a
// second one. Products list is small (four packs) so a couple of pages is
// always enough.
async function findProductByPackId(packId) {
  let startingAfter;
  for (let page = 0; page < 10; page += 1) {
    const params = { limit: "100" };
    if (startingAfter) params.starting_after = startingAfter;
    const result = await stripeCall("products", params, { method: "GET" });
    const match = result.data.find((product) => product.metadata?.packId === packId);
    if (match) return match;
    if (!result.has_more) return null;
    startingAfter = result.data[result.data.length - 1]?.id;
    if (!startingAfter) return null;
  }
  return null;
}

// Amendment 12: read Stripe's *current* active Price(s) for the product —
// not the local cache — so a run that wants the same amount another dev
// already rotated to converges on that Price instead of creating a
// duplicate.
async function listActivePrices(productId) {
  const result = await stripeCall(
    "prices",
    { product: productId, active: "true", limit: "10", "expand[]": "data.currency_options" },
    { method: "GET" },
  );
  return result.data;
}

function priceMatches(price, amountEurCents, amountUsdCents) {
  if (!price) return false;
  if (price.unit_amount !== amountEurCents) return false;
  return price.currency_options?.usd?.unit_amount === amountUsdCents;
}

// Stripe returns `tax_code` as a bare id unless it is expanded; tolerate both so
// the comparison below never reads an object as "no tax code" and rewrites a
// product that is already correct.
function taxCodeIdOf(product) {
  const value = product?.tax_code;
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

// A cached product id can be stale — deleted in the dashboard, or belonging to a
// different Stripe account after a key rotation. Treat "cannot read it" as "we
// do not have it" and fall through to the metadata lookup, rather than crashing
// a sync over a bad cache entry.
async function retrieveProduct(productId) {
  try {
    return await stripeCall(`products/${productId}`, {}, { method: "GET" });
  } catch {
    return null;
  }
}

async function ensureStripeProductAndPrice(pack, cachedProductId, amountEurCents, amountUsdCents) {
  let product = cachedProductId ? await retrieveProduct(cachedProductId) : null;
  if (!product) {
    product = await findProductByPackId(pack.id);
  }

  let taxCodeAction = "ok";
  if (!product) {
    product = await stripeCall(
      "products",
      {
        name: `HireCall credits — ${pack.creditsGranted} interviews`,
        "metadata[packId]": pack.id,
        tax_code: PRODUCT_TAX_CODE,
      },
      { idempotencyKey: `credit-pack-product:${pack.id}` },
    );
    taxCodeAction = "set";
  } else if (taxCodeIdOf(product) !== PRODUCT_TAX_CODE) {
    // The backfill pass. Products created before the tax code was required have
    // none, and every checkout against them fails; `tax_code` is mutable on a
    // Product (unlike `tax_behavior` on a Price), so this repairs them in place
    // without rotating anything. Guarded by the comparison above, so a second run
    // writes nothing — the sync stays idempotent.
    product = await stripeCall(`products/${product.id}`, { tax_code: PRODUCT_TAX_CODE });
    taxCodeAction = "backfilled";
  }

  const productId = product.id;
  const activePrices = await listActivePrices(productId);
  const matching = activePrices.find((price) => priceMatches(price, amountEurCents, amountUsdCents));

  if (matching) {
    return {
      productId,
      priceId: matching.id,
      confirmedEurCents: matching.unit_amount,
      confirmedUsdCents: matching.currency_options.usd.unit_amount,
      taxCodeAction,
    };
  }

  await Promise.all(
    activePrices.map((price) => stripeCall(`prices/${price.id}`, { active: "false" })),
  );

  const price = await stripeCall("prices", {
    product: productId,
    unit_amount: String(amountEurCents),
    currency: "eur",
    tax_behavior: "exclusive",
    "currency_options[usd][unit_amount]": String(amountUsdCents),
    "currency_options[usd][tax_behavior]": "exclusive",
    "metadata[packId]": pack.id,
    "expand[]": "currency_options",
  });

  return {
    productId,
    priceId: price.id,
    confirmedEurCents: price.unit_amount,
    confirmedUsdCents: price.currency_options.usd.unit_amount,
    taxCodeAction,
  };
}

async function syncPack(prisma, pack) {
  const existing = await prisma.creditPack.findUnique({ where: { id: pack.id } });
  const desiredEurCents = overrides[pack.id]?.eur ?? pack.unitAmountCents;
  const desiredUsdCents = overrides[pack.id]?.usd ?? pack.unitAmountCentsUsd;

  if (!stripeKey) {
    // Local-only mode never touches Stripe and never writes a price amount
    // on an update — only a first insert seeds the cache from PACKS, per
    // the controller decision: a keyless dev environment stays displayable,
    // but a keyless run can never desynchronize a price Stripe has already
    // confirmed.
    if (existing) {
      await prisma.creditPack.update({
        where: { id: pack.id },
        data: {
          creditsGranted: pack.creditsGranted,
          visibility: pack.visibility,
          displayOrder: pack.displayOrder,
        },
      });
    } else {
      await prisma.creditPack.create({
        data: {
          id: pack.id,
          creditsGranted: pack.creditsGranted,
          unitAmountCents: pack.unitAmountCents,
          unitAmountCentsUsd: pack.unitAmountCentsUsd,
          currency: "EUR",
          visibility: pack.visibility,
          displayOrder: pack.displayOrder,
        },
      });
    }
    console.log(`${pack.id}: ${pack.unitAmountCents / 100}€ (local only — no STRIPE_SECRET_KEY)`);
    return;
  }

  const { productId, priceId, confirmedEurCents, confirmedUsdCents, taxCodeAction } =
    await ensureStripeProductAndPrice(
      pack,
      existing?.stripeProductId,
      desiredEurCents,
      desiredUsdCents,
    );

  await prisma.creditPack.upsert({
    where: { id: pack.id },
    create: {
      id: pack.id,
      creditsGranted: pack.creditsGranted,
      unitAmountCents: confirmedEurCents,
      unitAmountCentsUsd: confirmedUsdCents,
      currency: "EUR",
      stripeProductId: productId,
      stripePriceId: priceId,
      visibility: pack.visibility,
      displayOrder: pack.displayOrder,
    },
    update: {
      creditsGranted: pack.creditsGranted,
      unitAmountCents: confirmedEurCents,
      unitAmountCentsUsd: confirmedUsdCents,
      stripeProductId: productId,
      stripePriceId: priceId,
      visibility: pack.visibility,
      displayOrder: pack.displayOrder,
    },
  });

  console.log(
    `${pack.id}: ${confirmedEurCents / 100}€ / $${confirmedUsdCents / 100} ` +
      `product=${productId} price=${priceId} tax_code=${PRODUCT_TAX_CODE} (${taxCodeAction})`,
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  let synced = 0;
  try {
    for (const pack of PACKS) {
      try {
        await syncPack(prisma, pack);
        synced += 1;
      } catch (error) {
        console.error(`synced ${synced}/${PACKS.length} packs — failed on ${pack.id}`);
        throw error;
      }
    }
    console.log(`synced ${synced}/${PACKS.length} packs`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
