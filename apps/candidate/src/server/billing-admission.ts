import {
  evaluateWorkspaceEntitlement,
  resolveBillingUsagePeriod,
} from "@prelude/billing";
import { getWorkspaceBilling } from "@prelude/billing/server";
import { prisma, type Prisma, type PrismaClient } from "@prelude/db";

type CandidateSessionCreateData = Prisma.CandidateSessionUncheckedCreateInput;
type BillingAdmissionDatabase = Pick<PrismaClient, "$transaction">;

type BillingAdmissionDependencies = {
  database: BillingAdmissionDatabase;
  loadBilling: typeof getWorkspaceBilling;
};

type CreateEntitledCandidateSessionInput = {
  data: CandidateSessionCreateData;
  now: Date;
  organizationId: string;
};

const defaultDependencies: BillingAdmissionDependencies = {
  database: prisma,
  loadBilling: getWorkspaceBilling,
};

export async function createEntitledCandidateSession(
  input: CreateEntitledCandidateSessionInput,
  dependencies: BillingAdmissionDependencies = defaultDependencies,
) {
  const billing = await dependencies.loadBilling({
    organizationId: input.organizationId,
    now: input.now,
  });
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
