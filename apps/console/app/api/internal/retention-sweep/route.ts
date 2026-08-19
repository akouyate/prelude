import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import {
  candidateDataRetentionMonths,
  sweepExpiredCandidateData,
} from "../../../../src/server/interviews/candidate-erasure";

/**
 * The 12-month retention sweep — the clock behind the promise the candidate
 * consent copy makes: "the transcript and the recruiter's brief are kept for up
 * to 12 months and then permanently deleted".
 *
 * ── Why here, and not in the Go service ───────────────────────────────────────
 *
 * The Go realtime service already runs a retention sweep, for AUDIO (90 days, on
 * its reconciliation ticker). This one cannot join it: erasing a transcript and
 * a brief means deleting a `CandidateBrief` row and clearing identity on a
 * `CandidateSession` and its invitation — console-owned tables the Go service
 * has no business writing. Erasure is orchestrated by the console (see
 * `candidate-erasure.ts`), so its bulk form is orchestrated by the console too.
 * One owner, one code path: the sweep IS the erasure, run over a selection.
 *
 * ── Runbook ───────────────────────────────────────────────────────────────────
 *
 *   POST /api/internal/retention-sweep?limit=<n>
 *   Authorization: Bearer $RETENTION_SWEEP_SECRET
 *
 * Schedule it DAILY in every environment holding real candidate data. Generate
 * the secret with `openssl rand -hex 32`; the route answers 503 until it is set,
 * so an environment that forgets it is loudly broken rather than quietly
 * un-swept — which for this endpoint would mean silently keeping candidate data
 * past the retention it promised.
 *
 * Its own secret, separate from `BILLING_SWEEP_SECRET`, on purpose: the two
 * sweeps have different blast radii (money vs. irreversible deletion) and
 * different schedules, and a shared credential would let a leak of the harmless
 * one drive the destructive one.
 *
 * ── Response ──────────────────────────────────────────────────────────────────
 *
 * Always 200 once authenticated, and always a report:
 *
 *   { cutoff, erased, failed, hasMore, scanned, retentionMonths, durationMs }
 *
 * `failed` is a REPORT, not an HTTP failure: one candidate session whose
 * realtime erasure is refused must not make the scheduler retry the whole batch
 * forever, nor hide the sessions that WERE erased. `hasMore` says the page came
 * back full; the next run picks up where this one stopped, because the selection
 * is "not yet erased" and therefore self-advancing — there is no cursor to lose.
 */

const DEFAULT_SESSION_LIMIT = 200;
const MAX_SESSION_LIMIT = 2_000;

export async function POST(request: NextRequest) {
  if (!isAuthorizedSweepCaller(request)) {
    return sweepAuthFailure();
  }

  const limit = readLimit(request.nextUrl.searchParams);
  if (limit === null) {
    return new Response("Invalid limit: expected an integer between 1 and 2000", {
      status: 400,
    });
  }

  const startedAt = Date.now();
  try {
    const report = await sweepExpiredCandidateData({ limit });
    return Response.json({
      ...report,
      durationMs: Date.now() - startedAt,
      retentionMonths: candidateDataRetentionMonths,
    });
  } catch (error) {
    // Postgres unreachable, the pool exhausted. Name the failure in OUR log and
    // hand the scheduler a JSON body shaped like every other response it parses,
    // rather than Next's opaque HTML error page.
    console.error("[retention-sweep] the sweep could not run", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { durationMs: Date.now() - startedAt, error: "sweep_failed" },
      { status: 500 },
    );
  }
}

/**
 * A route handler under `app/api` is reachable by anyone unless something stops
 * them, and this one PERMANENTLY DELETES candidate data. So: 503 while the
 * secret is unset (an unset secret must never mean "everything matches"), 401
 * for everything that does not present it, and a constant-time compare in
 * between so the token cannot be recovered a byte at a time.
 */
function isAuthorizedSweepCaller(request: NextRequest): boolean {
  const expected = process.env.RETENTION_SWEEP_SECRET?.trim();
  if (!expected) return false;

  const header = request.headers.get("authorization")?.trim() ?? "";
  const [scheme, ...rest] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return false;

  const presented = Buffer.from(rest.join(" "), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  // `timingSafeEqual` THROWS on unequal lengths, so the length check comes
  // first. It leaks the secret's length and nothing else, which is not a secret.
  if (presented.length !== expectedBuffer.length) return false;

  return timingSafeEqual(presented, expectedBuffer);
}

function sweepAuthFailure(): Response {
  if (!process.env.RETENTION_SWEEP_SECRET?.trim()) {
    console.error("[retention-sweep] refused: RETENTION_SWEEP_SECRET is not configured");
    return new Response("Retention sweep is not configured", { status: 503 });
  }
  return new Response("Unauthorized", { status: 401 });
}

/** `null` means "the caller sent something we will not guess at" → 400. */
function readLimit(params: URLSearchParams): number | null {
  const raw = params.get("limit");
  if (raw === null) return DEFAULT_SESSION_LIMIT;
  // A silent clamp would make a typo'd `?limit=100000` look like it worked.
  if (!/^\d+$/.test(raw.trim())) return null;

  const limit = Number(raw.trim());
  if (limit < 1 || limit > MAX_SESSION_LIMIT) return null;

  return limit;
}
