import "server-only";

import { prisma } from "@prelude/db";

/**
 * ── WHO ERASES WHAT ───────────────────────────────────────────────────────────
 *
 * A candidate's data does not live in one place, so no single service can honour
 * the right to erasure alone:
 *
 *   - the Go realtime service owns the audio objects (Cloudflare R2) and the
 *     append-only event log the transcript is derived from;
 *   - the console owns the product aggregate — `CandidateSession`, the generated
 *     `CandidateBrief`, and the candidate's identity on the invitation.
 *
 * The CONSOLE orchestrates, for two reasons that are not stylistic. It is the
 * only side that knows `organizationId`, so it is the only side that can scope
 * the act to one workspace; and the tombstone is a product fact a recruiter
 * reads on a page, not a runtime fact. The Go service therefore exposes ONE
 * endpoint (`DELETE /v1/interview-sessions/{id}/personal-data`) that erases its
 * whole share, and this module calls it and then writes the local tombstone.
 *
 * ── WHAT ERASURE PHYSICALLY MEANS ─────────────────────────────────────────────
 *
 * Deletion, not redaction (the LF ruling is explicit). On the Go side the event
 * rows are DELETED — the log is append-only, so redacting payloads in place
 * would contradict its own contract — while the session row survives. Here the
 * `CandidateBrief` row is deleted, and `candidateName` / `candidateEmail` /
 * `resumeToken` are nulled on the session and on its invitation.
 *
 * ── WHAT SURVIVES, AND WHY ────────────────────────────────────────────────────
 *
 * Art. 17(3)(b)/(e): ids, timestamps, status, the erasure stamp, and the billing
 * trace (`billedAnsweredCount` / `billedRequiredCount` / `billedOutcome`) — no
 * content, no assessment, no identity. This is what the candidate consent copy
 * promises ("only a technical record remains showing that an interview took
 * place and on what date"), so the write below clears an explicit list rather
 * than assembling one: a field this module does not name is a field it does not
 * touch, which is the property that keeps the billing trace intact by
 * construction rather than by memory.
 */

/**
 * The transcript's and the brief's shared horizon (the recording's own 90 days
 * are enforced separately, by the Go retention sweep). Anchored on
 * `CandidateSession.completedAt` — an interview that never completed has no
 * horizon to start, and is erased on request only.
 */
export const candidateDataRetentionMonths = 12;

/** `erasureReason` values. They distinguish a right exercised from a clock. */
export const erasureReasonRequest = "erasure_request";
export const erasureReasonRetention = "retention";

export type ErasureReason =
  | typeof erasureReasonRequest
  | typeof erasureReasonRetention;

export type EraseCandidateSessionResult =
  | { erased: false; reason: "not_found" }
  // `realtimeSessionId` is returned because it SURVIVES erasure (it is an id,
  // not content) and the detail route resolves to it when present — the caller
  // needs it to revalidate the page the recruiter is actually looking at.
  | { erased: true; realtimeSessionId: string | null };

export function retentionCutoffFor(now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - candidateDataRetentionMonths);
  return cutoff;
}

// The console reaches the Go realtime API the same way `recording-actions` does.
// Resolved per call (not at module load) so the URL reflects the live env.
function realtimeApiUrl() {
  return process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";
}

// The realtime API verifies REALTIME_API_KEY on every non-public route. When it
// is unset (local dev) no header is sent and the Go API serves auth-disabled.
function realtimeAuthHeaders(): Record<string, string> {
  const apiKey = process.env.REALTIME_API_KEY?.trim();
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/**
 * Erases one candidate session's personal data, everywhere it lives.
 *
 * Scoped by `organizationId` on every read and write, so a session belonging to
 * another workspace is simply not found — never erased across a tenant boundary.
 *
 * Idempotent by construction: the Go endpoint no-ops on a second call, the brief
 * delete is a `deleteMany`, and the nulls are already null. An already-erased
 * session keeps its FIRST `erasedAt`/`erasureReason` — the moment the right was
 * honoured is a fact, and a retry (or a later sweep) must not rewrite it.
 *
 * Ordering is load-bearing: the remote content goes first, and its failure
 * ABORTS the local tombstone. The reverse order would leave a session reading
 * "erased" on screen while the transcript and audio still exist — the one state
 * this must never produce, since the page would then repeat the lie to whoever
 * asks. A thrown error leaves a fully retryable state instead.
 */
export async function eraseCandidateSessionData({
  candidateSessionId,
  now = new Date(),
  organizationId,
  reason,
}: {
  candidateSessionId: string;
  now?: Date;
  organizationId: string;
  reason: ErasureReason;
}): Promise<EraseCandidateSessionResult> {
  const session = await prisma.candidateSession.findFirst({
    select: {
      candidateInvitationId: true,
      erasedAt: true,
      erasureReason: true,
      id: true,
      realtimeSessionId: true,
    },
    where: { id: candidateSessionId, organizationId },
  });
  if (!session) {
    return { erased: false, reason: "not_found" };
  }

  if (session.realtimeSessionId) {
    const response = await fetch(
      `${realtimeApiUrl()}/v1/interview-sessions/${encodeURIComponent(
        session.realtimeSessionId,
      )}/personal-data`,
      { headers: realtimeAuthHeaders(), method: "DELETE" },
    );
    if (!response.ok) {
      throw new Error(
        "Failed to erase the interview recording and transcript. Please try again.",
      );
    }
  }

  // The single instant this erasure is stamped with, everywhere it is written.
  // First-write-wins: a retry (or a later sweep over an already-erased session)
  // must not move the moment the right was honoured, on the session or on the
  // invitation it expired.
  const erasedAt = session.erasedAt ?? now;

  await prisma.$transaction([
    // Org-scoped too, not just keyed by the session: defence in depth on the one
    // write that removes generated assessment about a person.
    prisma.candidateBrief.deleteMany({
      where: { candidateSessionId: session.id, organizationId },
    }),
    // `updateMany`, not `update`: `update` only accepts a UNIQUE where, and
    // `organizationId` is not part of any unique key on this model. Carrying the
    // scope matters more than the ergonomics — every write in this transaction
    // then states the tenant it belongs to, instead of two of them trusting that
    // the caller filtered. Behaviour is unchanged: the id is already unique, so
    // this updates exactly the row `findFirst` returned, or none.
    prisma.candidateSession.updateMany({
      data: {
        candidateEmail: null,
        candidateName: null,
        erasedAt,
        erasureReason: session.erasureReason ?? reason,
        resumeToken: null,
      },
      where: { id: session.id, organizationId },
    }),
    /*
     * The invitation holds the same name and email — the identity the recruiter
     * typed when inviting — so those are cleared here too.
     *
     * KILLING THE LINK IS PART OF THE ERASURE, not housekeeping. The invitation
     * token is a live credential: it is the URL that was emailed to the
     * candidate, and it stays in their inbox after erasure. Left usable, the
     * next click would start a FRESH session that asks for their name and email
     * again — an erasure the data subject can undo by clicking their own link,
     * and a re-collection with no basis (Art. 17, and the storage-limitation
     * duty of Art. 5(1)(e)). So the same write terminates it.
     *
     * `status: "expired"` is the existing terminal status whose meaning is
     * exactly "this link no longer opens" (see `candidateLifecycleTerminalStatuses`
     * in @prelude/core); no new status is invented. `expiresAt` is set
     * ALONGSIDE it rather than instead of it, because the two are enforced by
     * different readers: `prepareCandidateSession` refuses on either, while
     * paths that only ask "is this invitation still open" (the console's
     * `candidatePathForInterview`, `expireStaleCandidateInvitations`) look at
     * the date. Writing both leaves no reader that still sees a live link.
     *
     * `token` itself is deliberately left alone: it is an opaque identifier,
     * not personal data, and it is `@unique` and non-nullable, so clearing it is
     * not expressible without inventing a value. It is now inert.
     *
     * A recruiter can still REISSUE an expired invitation, which is correct and
     * safe: reissue copies name and email from the source row, and those are
     * null by the time this transaction commits — so it produces a blank new
     * invitation and can never resurrect what was erased.
     */
    ...(session.candidateInvitationId
      ? [
          prisma.candidateInvitation.updateMany({
            data: {
              candidateEmail: null,
              candidateName: null,
              expiresAt: erasedAt,
              status: "expired",
            },
            where: { id: session.candidateInvitationId, organizationId },
          }),
        ]
      : []),
  ]);

  return { erased: true, realtimeSessionId: session.realtimeSessionId };
}

export type RetentionSweepReport = {
  cutoff: string;
  erased: number;
  failed: number;
  hasMore: boolean;
  scanned: number;
};

/**
 * The 12-month sweep. It is NOT a second deletion routine: it selects the
 * expired sessions and runs each through `eraseCandidateSessionData` above, with
 * `reason: "retention"`. One code path means the sweep can never drift from the
 * on-request erasure — the tombstone it writes is the same tombstone, by
 * construction rather than by review.
 *
 * Deliberately cross-organization: storage limitation is an obligation of the
 * platform, not of a workspace, and there is no recruiter in the loop to supply
 * a scope. Each session is nonetheless erased under ITS OWN `organizationId`, so
 * the scoped path stays scoped.
 *
 * Best-effort per session: one failure (an unreachable realtime service, say) is
 * counted and logged, never allowed to abort the batch — a single stuck session
 * must not indefinitely postpone everyone else's deletion.
 */
export async function sweepExpiredCandidateData({
  limit,
  now = new Date(),
}: {
  limit: number;
  now?: Date;
}): Promise<RetentionSweepReport> {
  const cutoff = retentionCutoffFor(now);
  const expired = await prisma.candidateSession.findMany({
    orderBy: { completedAt: "asc" },
    select: { id: true, organizationId: true },
    take: limit,
    where: {
      completedAt: { lte: cutoff, not: null },
      erasedAt: null,
    },
  });

  let erased = 0;
  let failed = 0;
  for (const session of expired) {
    try {
      const result = await eraseCandidateSessionData({
        candidateSessionId: session.id,
        now,
        organizationId: session.organizationId,
        reason: erasureReasonRetention,
      });
      if (result.erased) erased += 1;
    } catch (error) {
      failed += 1;
      console.error("[retention-sweep] erasing one candidate session failed", {
        candidateSessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    cutoff: cutoff.toISOString(),
    erased,
    failed,
    // A full page means there is very likely more behind it. The next scheduled
    // run picks it up: the selection is `erasedAt: null`, so progress is made on
    // every pass without a cursor to lose.
    hasMore: expired.length === limit,
    scanned: expired.length,
  };
}
