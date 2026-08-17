#!/usr/bin/env node

// Lists the Stripe webhook events parked for a human — amendment 8's operator
// queue, the rows `POST /api/internal/billing-sweep` reports as `needsAdminCount`
// and `failedCount`.
//
// `needs_admin` is TERMINAL for the status column: only an operator clears it, and
// a replay that later succeeds does not erase it. So this list is the actual work
// queue, not a transient view — a row stays here until someone has looked at the
// payment behind it and decided what happened.
//
// Node rather than psql-in-make on purpose: `make` would need a `psql` client on
// the host (the repo only guarantees one inside the Docker container), and the
// column selection plus NULL-safe truncation of `firstError` would turn into
// shell-quoted SQL inside a recipe. This reuses the Prisma client the repo already
// generates, exactly as `sync-credit-packs.mjs` does.
import { createRequire } from "node:module";

const requireFromDbPackage = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { PrismaClient } = requireFromDbPackage("@prisma/client");

const PARKED_STATUSES = ["needs_admin", "failed"];
// `make` passes the variable through even when unset, so an EMPTY string has to
// mean "default" — `Number("")` is 0 and would silently list nothing.
const rawLimit = process.env.BILLING_ADMIN_QUEUE_LIMIT?.trim();
const LIMIT = rawLimit && /^\d+$/.test(rawLimit) && Number(rawLimit) > 0 ? Number(rawLimit) : 50;
const ERROR_WIDTH = 70;

function truncate(value, width) {
  if (!value) return "—";
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > width ? `${oneLine.slice(0, width - 1)}…` : oneLine;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.stripeWebhookEvent.findMany({
      orderBy: { receivedAt: "asc" },
      select: {
        attemptCount: true,
        firstError: true,
        id: true,
        receivedAt: true,
        status: true,
        stripeEventId: true,
        type: true,
      },
      take: LIMIT,
      where: { status: { in: PARKED_STATUSES } },
    });

    if (rows.length === 0) {
      console.log("Billing admin queue is empty (no needs_admin or failed webhook events).");
      return;
    }

    console.log(`Billing admin queue — ${rows.length} row(s), oldest first:\n`);
    for (const row of rows) {
      console.log(`  id            ${row.id}`);
      console.log(`  stripeEventId ${row.stripeEventId}`);
      console.log(`  type          ${row.type}`);
      console.log(`  status        ${row.status}`);
      console.log(`  attemptCount  ${row.attemptCount}`);
      console.log(`  firstError    ${truncate(row.firstError, ERROR_WIDTH)}`);
      console.log(`  receivedAt    ${row.receivedAt.toISOString()}`);
      console.log("");
    }

    const byStatus = PARKED_STATUSES.map(
      (status) => `${status}=${rows.filter((row) => row.status === status).length}`,
    ).join(" ");
    console.log(`Totals (within the ${LIMIT}-row limit): ${byStatus}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
