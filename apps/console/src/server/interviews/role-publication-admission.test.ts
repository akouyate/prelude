import { describe, expect, it, vi } from "vitest";

import {
  unconfiguredBilling,
  workspacePlanCatalog,
  type WorkspaceBilling,
} from "@prelude/billing";

import {
  evaluateRolePublicationAdmission,
  runSerializableTransaction,
} from "./role-publication-admission";

const now = new Date("2026-07-24T10:00:00.000Z");

describe("role publication admission", () => {
  it("does not consume another slot when this role is already published", async () => {
    const client = fakeClient({ publishedForJob: 1, publishedRoleUsage: 25 });

    await expect(
      evaluateRolePublicationAdmission(client as never, {
        billing: paidBilling(),
        jobId: "job_1",
        organizationId: "org_1",
      }),
    ).resolves.toEqual({ allowed: true });
    expect(client.job.count).not.toHaveBeenCalled();
  });

  it("blocks a new active role exactly at the workspace limit", async () => {
    const client = fakeClient({ publishedForJob: 0, publishedRoleUsage: 25 });

    await expect(
      evaluateRolePublicationAdmission(client as never, {
        billing: paidBilling(),
        jobId: "job_1",
        organizationId: "org_1",
      }),
    ).resolves.toEqual({
      allowed: false,
      code: "published_role_limit_reached",
    });
  });

  it("allows local unconfigured development without a quota", async () => {
    const client = fakeClient({
      publishedForJob: 0,
      publishedRoleUsage: 10_000,
    });

    await expect(
      evaluateRolePublicationAdmission(client as never, {
        billing: unconfiguredBilling(now),
        jobId: "job_1",
        organizationId: "org_1",
      }),
    ).resolves.toEqual({ allowed: true });
  });
});

describe("serializable role publication", () => {
  it("retries a serialization conflict before succeeding", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2034" })
      .mockResolvedValueOnce("ok");

    await expect(runSerializableTransaction(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

function fakeClient({
  publishedForJob,
  publishedRoleUsage,
}: {
  publishedForJob: number;
  publishedRoleUsage: number;
}) {
  return {
    interview: { count: vi.fn(async () => publishedForJob) },
    job: { count: vi.fn(async () => publishedRoleUsage) },
  };
}

function paidBilling(): WorkspaceBilling {
  return {
    accessAllowed: true,
    entitlements: workspacePlanCatalog.v1_workspace,
    isFreeTrial: false,
    periodEnd: new Date("2026-08-01T00:00:00.000Z"),
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    planId: "plan_1",
    planKey: "v1_workspace",
    planName: "V1 Workspace",
    planSlug: "v1-workspace",
    sourceUpdatedAt: now,
    state: "active",
    subscriptionId: "sub_1",
    subscriptionItemId: "item_1",
    subscriptionItemStatus: "active",
    subscriptionStatus: "active",
  };
}
