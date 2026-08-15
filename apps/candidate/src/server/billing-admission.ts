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
type BillingAdmissionDatabase = Pick<
  PrismaClient,
  "$transaction" | "candidateSession"
>;

type BillingAdmissionDependencies = {
  database: BillingAdmissionDatabase;
  loadBilling: typeof getWorkspaceBilling;
  reserveCredit: typeof reserveCreditForSession;
};

type CreateEntitledCandidateSessionInput = {
  data: CandidateSessionCreateData;
  now: Date;
  organizationId: string;
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

  const reservation = await dependencies.reserveCredit(
    dependencies.database as PrismaClient,
    {
      organizationId: input.organizationId,
      candidateSessionId: session.id,
      now: input.now,
    },
  );

  if (reservation.ok) {
    return { ok: true as const, session };
  }

  // Compensating delete rather than a wrapping transaction: `reserveCredit`
  // already committed (or refused) on its own, so there is nothing left to roll
  // back atomically. A crash between the create above and this delete leaves an
  // orphaned session with no reservation; settlement (Task 7) treats a missing
  // reservation as a `no_reservation` no-op, and no credit was ever taken for
  // it, so the tradeoff is a stray session row, never a leaked credit.
  await dependencies.database.candidateSession.delete({
    where: { id: session.id },
  });

  return {
    error: "candidate_interview_limit_reached" as const,
    ok: false as const,
  };
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
