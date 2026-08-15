import {
  evaluateWorkspaceEntitlement,
  isCreditBillingEnabled,
  resolveBillingUsagePeriod,
  reserveCreditForSession,
  type WorkspaceBilling,
} from "@prelude/billing";
import { getWorkspaceBilling } from "@prelude/billing/server";
import { prisma, type Prisma, type PrismaClient } from "@prelude/db";

type CandidateSessionCreateData = Prisma.CandidateSessionUncheckedCreateInput;
// The full client, not a narrower `Pick`: `reserveCredit` (Task 4's
// `reserveCreditForSession`) is frozen at `db: PrismaClient`, and under
// TypeScript's contravariant function-parameter checking no `Pick` — however
// wide — is assignable where a full `PrismaClient` is required, so a narrower
// alias here would only reintroduce a cast at the `reserveCredit` call below.
// In practice this admission module touches `candidateSession` directly and,
// via `reserveCredit`, `creditWallet` / `creditLot` / `creditReservation` /
// `creditLedgerEntry` — never anything else on the client.
type BillingAdmissionDatabase = PrismaClient;

type BillingAdmissionDependencies = {
  database: BillingAdmissionDatabase;
  loadBilling: typeof getWorkspaceBilling;
  reserveCredit: typeof reserveCreditForSession;
};

type ResumeAdmissionDependencies = Pick<
  BillingAdmissionDependencies,
  "database" | "reserveCredit"
>;

type CreateEntitledCandidateSessionInput = {
  data: CandidateSessionCreateData;
  now: Date;
  organizationId: string;
};

type ResumeEntitledCandidateSessionInput = {
  data: Prisma.CandidateSessionUncheckedUpdateInput;
  now: Date;
  organizationId: string;
  sessionId: string;
};

const defaultDependencies: BillingAdmissionDependencies = {
  database: prisma,
  loadBilling: getWorkspaceBilling,
  reserveCredit: reserveCreditForSession,
};

export async function createEntitledCandidateSession(
  input: CreateEntitledCandidateSessionInput,
  dependencies: BillingAdmissionDependencies = defaultDependencies,
) {
  const billing = await dependencies.loadBilling({
    organizationId: input.organizationId,
    now: input.now,
  });

  if (isCreditBillingEnabled()) {
    return createCreditBackedCandidateSession(input, dependencies, billing);
  }

  const period = resolveBillingUsagePeriod(billing, input.now);

  return runSerializable(async () =>
    dependencies.database.$transaction(
      async (transaction) => {
        const usage = await transaction.candidateSession.count({
          where: {
            organizationId: input.organizationId,
            startedAt: {
              gte: period.start,
              lt: period.end,
            },
            OR: [
              { status: { not: "failed" } },
              { realtimeSessionId: { not: null } },
            ],
          },
        });
        const interviewDecision = evaluateWorkspaceEntitlement({
          billing,
          feature: "candidate_interviews",
          usage,
        });

        if (!interviewDecision.allowed) {
          return {
            error:
              interviewDecision.code === "usage_limit_reached"
                ? ("candidate_interview_limit_reached" as const)
                : ("billing_unavailable" as const),
            ok: false as const,
          };
        }

        const recordingDecision = evaluateWorkspaceEntitlement({
          billing,
          feature: "recording",
          usage: 0,
        });
        const session = await transaction.candidateSession.create({
          data: {
            ...input.data,
            recordingEntitled: recordingDecision.allowed,
          },
        });

        return { ok: true as const, session };
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

/**
 * Admission for a session that already exists: resuming an attempt still needs a
 * credit behind it, otherwise the ledger's own invariant — no interview runs
 * without one — holds only for the first attempt.
 *
 * The common resume (a reconnect minutes later, hold still live) costs nothing:
 * `reserveCredit` is idempotent and hands the existing hold back. The resumes
 * that genuinely take a credit are the ones that would otherwise run free — an
 * attempt resumed after its hold was swept at `RESERVATION_TTL_HOURS`, a session
 * `deleteOrphanedSession` below failed to clean up, and a session created while
 * the flag was off and resumed after it was turned on.
 *
 * Reserving before the update is what makes a refusal harmless: the session is
 * left exactly as it was, so the candidate can retry once the wallet is topped
 * up. Nothing is created here, so a refusal has nothing to compensate either.
 */
export async function resumeEntitledCandidateSession(
  input: ResumeEntitledCandidateSessionInput,
  dependencies: ResumeAdmissionDependencies = defaultDependencies,
) {
  if (isCreditBillingEnabled()) {
    const reservation = await dependencies.reserveCredit(
      dependencies.database,
      {
        organizationId: input.organizationId,
        candidateSessionId: input.sessionId,
        now: input.now,
      },
    );

    if (!reservation.ok) {
      return {
        error: "candidate_interview_limit_reached" as const,
        ok: false as const,
      };
    }
  }

  return {
    ok: true as const,
    session: await dependencies.database.candidateSession.update({
      data: input.data,
      where: { id: input.sessionId },
    }),
  };
}

/**
 * Prepaid-credit admission path (`CREDIT_BILLING_ENABLED=1`). `reserveCredit`
 * (Task 4) opens its own per-organization wallet transaction, so it cannot run
 * inside the transaction that creates the session — see Task 6 brief's Step 3
 * resolution. The session is therefore created first, outside any transaction,
 * and the reservation is taken against the id it was given.
 */
async function createCreditBackedCandidateSession(
  input: CreateEntitledCandidateSessionInput,
  dependencies: BillingAdmissionDependencies,
  billing: WorkspaceBilling,
) {
  const recordingDecision = evaluateWorkspaceEntitlement({
    billing,
    feature: "recording",
    usage: 0,
  });

  const session = await dependencies.database.candidateSession.create({
    data: {
      ...input.data,
      recordingEntitled: recordingDecision.allowed,
    },
  });

  let reservation;
  try {
    reservation = await dependencies.reserveCredit(dependencies.database, {
      organizationId: input.organizationId,
      candidateSessionId: session.id,
      now: input.now,
    });
  } catch (error) {
    // reserveCredit can throw (P2028 retry exhaustion, a ledger integrity
    // error) without ever reaching an ok/no_credits_available decision.
    // Best-effort compensate exactly as a refusal does below, then let the
    // original error surface — swallowing it here would hide a real failure
    // behind a fabricated admission outcome.
    await deleteOrphanedSession(dependencies, session.id);
    throw error;
  }

  if (reservation.ok) {
    return { ok: true as const, session };
  }

  // `reserveCredit` already committed its refusal on its own (no wrapping
  // transaction is possible here — see the function doc above), so there is
  // nothing left to roll back atomically; this is a best-effort compensating
  // delete, not a guarantee.
  await deleteOrphanedSession(dependencies, session.id);

  return {
    error: "candidate_interview_limit_reached" as const,
    ok: false as const,
  };
}

/**
 * Best-effort cleanup for a session created without a live credit
 * reservation (refused, or `reserveCredit` threw). The failure mode if this
 * delete itself fails is not merely "a stray row": the session was created
 * with `status: "starting"`, and the candidate's next request against it
 * resolves to `resolveCandidateStartPolicy`'s `resume_same_attempt`, whose
 * branch in `public-interviews.ts` updates the existing row directly and
 * never calls back into `createEntitledCandidateSession` — so the interview
 * would run to completion without ever being charged. Logging and swallowing
 * here (rather than surfacing a 500 for a refusal that already succeeded) is
 * deliberate: the immediate backstop is Task 7's settlement treating a
 * missing reservation as a `no_reservation` no-op, and closing the
 * resume-branch charge gap itself is Task 7 follow-up, not this admission
 * path.
 */
async function deleteOrphanedSession(
  dependencies: BillingAdmissionDependencies,
  sessionId: string,
): Promise<void> {
  try {
    await dependencies.database.candidateSession.delete({
      where: { id: sessionId },
    });
  } catch (error) {
    console.error(
      "[billing-admission] failed to delete orphaned candidate session after a credit reservation failure",
      { sessionId, error },
    );
  }
}

async function runSerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Unreachable serialization retry state.");
}

function isSerializationConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}
