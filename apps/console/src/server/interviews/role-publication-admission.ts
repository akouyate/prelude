import {
  evaluateWorkspaceEntitlement,
  type WorkspaceBilling,
} from "@prelude/billing";
import type { Prisma } from "@prelude/db";

export type RolePublicationAdmissionCode =
  | "billing_unavailable"
  | "published_role_limit_reached";

type RolePublicationClient = Pick<
  Prisma.TransactionClient,
  "interview" | "job"
>;

export async function evaluateRolePublicationAdmission(
  client: RolePublicationClient,
  input: {
    billing: WorkspaceBilling;
    jobId: string;
    organizationId: string;
  },
): Promise<
  | { allowed: true }
  | { allowed: false; code: RolePublicationAdmissionCode }
> {
  const roleAlreadyPublished =
    (await client.interview.count({
      where: {
        jobId: input.jobId,
        organizationId: input.organizationId,
        status: "published",
      },
    })) > 0;

  if (roleAlreadyPublished) {
    return { allowed: true };
  }

  const usage = await client.job.count({
    where: {
      organizationId: input.organizationId,
      interviews: { some: { status: "published" } },
    },
  });
  const decision = evaluateWorkspaceEntitlement({
    billing: input.billing,
    feature: "published_roles",
    usage,
  });

  if (decision.allowed) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code:
      decision.code === "usage_limit_reached"
        ? "published_role_limit_reached"
        : "billing_unavailable",
  };
}

export async function runSerializableTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
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
