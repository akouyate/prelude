import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeBillingSubscription,
  unconfiguredBilling,
  workspacePlanCatalog,
} from "@prelude/billing";

import { createEntitledCandidateSession } from "./billing-admission";

beforeEach(() => {
  // Flag-off is the deterministic default for every test in this file; the
  // credit-billing tests below opt in explicitly. Without this, a stray
  // `CREDIT_BILLING_ENABLED=1` in the ambient environment (e.g. the plan's
  // own smoke step) would silently flip the five legacy tests onto the
  // credit branch, where they'd fail on the `dependencies()` helper's bare
  // `vi.fn()` `reserveCredit` default.
  vi.stubEnv("CREDIT_BILLING_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const now = new Date("2026-07-24T12:00:00.000Z");

describe("createEntitledCandidateSession", () => {
  it("creates a paid session with recording entitlement below quota", async () => {
    const database = fakeDatabase(
      workspacePlanCatalog.v1_workspace.candidateInterviewLimit - 1,
    );
    const result = await createEntitledCandidateSession(
      sessionInput(),
      dependencies(database, paidBilling()),
    );

    expect(result).toMatchObject({
      ok: true,
      session: { recordingEntitled: true },
    });
    expect(database.candidateSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ recordingEntitled: true }),
    });
    expect(database.candidateSession.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org_1",
        OR: [
          { status: { not: "failed" } },
          { realtimeSessionId: { not: null } },
        ],
      }),
    });
  });

  it("blocks exactly at quota without creating a session", async () => {
    const database = fakeDatabase(
      workspacePlanCatalog.v1_workspace.candidateInterviewLimit,
    );
    const result = await createEntitledCandidateSession(
      sessionInput(),
      dependencies(database, paidBilling()),
    );

    expect(result).toEqual({
      error: "candidate_interview_limit_reached",
      ok: false,
    });
    expect(database.candidateSession.create).not.toHaveBeenCalled();
  });

  it("fails closed when billing is unavailable", async () => {
    const database = fakeDatabase(0);
    const result = await createEntitledCandidateSession(
      sessionInput(),
      dependencies(database, {
        ...paidBilling(),
        accessAllowed: false,
        state: "unavailable",
      }),
    );

    expect(result).toEqual({ error: "billing_unavailable", ok: false });
    expect(database.candidateSession.create).not.toHaveBeenCalled();
  });

  it("keeps local unconfigured development unmetered", async () => {
    const database = fakeDatabase(Number.MAX_SAFE_INTEGER);
    const result = await createEntitledCandidateSession(
      sessionInput(),
      dependencies(database, unconfiguredBilling(now)),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("retries a serialization conflict and rechecks the final quota slot", async () => {
    const database = fakeDatabase(
      workspacePlanCatalog.v1_workspace.candidateInterviewLimit,
    );
    database.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("serialization conflict"), { code: "P2034" }),
    );

    const result = await createEntitledCandidateSession(
      sessionInput(),
      dependencies(database, paidBilling()),
    );

    expect(result).toEqual({
      error: "candidate_interview_limit_reached",
      ok: false,
    });
    expect(database.$transaction).toHaveBeenCalledTimes(2);
    expect(database.candidateSession.create).not.toHaveBeenCalled();
  });

  it("reserves a credit instead of counting usage when credit billing is enabled", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
    const reserve = vi.fn().mockResolvedValue({ ok: true, reservationId: "res_1" });
    const database = fakeDatabase(0);
    const result = await createEntitledCandidateSession(sessionInput(), {
      ...dependencies(database, paidBilling()),
      reserveCredit: reserve,
    });

    expect(result).toMatchObject({
      ok: true,
      session: { recordingEntitled: true },
    });
    expect(reserve).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org_1",
      candidateSessionId: expect.any(String),
      now,
    });
    expect(database.candidateSession.count).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("refuses admission with the existing limit code and compensates the created session when the wallet is empty", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
    const reserve = vi.fn().mockResolvedValue({ ok: false, error: "no_credits_available" });
    const database = fakeDatabase(0);
    const result = await createEntitledCandidateSession(sessionInput(), {
      ...dependencies(database, paidBilling()),
      reserveCredit: reserve,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "candidate_interview_limit_reached",
    });
    expect(database.candidateSession.create).toHaveBeenCalledTimes(1);
    expect(database.candidateSession.delete).toHaveBeenCalledWith({
      where: { id: "candidate_session_1" },
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("still refuses cleanly when the compensating delete itself fails", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
    const reserve = vi.fn().mockResolvedValue({ ok: false, error: "no_credits_available" });
    const database = fakeDatabase(0);
    database.candidateSession.delete.mockRejectedValueOnce(new Error("db unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createEntitledCandidateSession(sessionInput(), {
      ...dependencies(database, paidBilling()),
      reserveCredit: reserve,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "candidate_interview_limit_reached",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("compensates and rethrows when reserveCredit itself throws", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
    const reserveError = new Error("connection lost");
    const reserve = vi.fn().mockRejectedValue(reserveError);
    const database = fakeDatabase(0);

    await expect(
      createEntitledCandidateSession(sessionInput(), {
        ...dependencies(database, paidBilling()),
        reserveCredit: reserve,
      }),
    ).rejects.toThrow(reserveError);

    expect(database.candidateSession.delete).toHaveBeenCalledWith({
      where: { id: "candidate_session_1" },
    });
  });

  it("keeps the legacy count-based path byte-for-byte when the flag is off", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "");
    const reserve = vi.fn();
    const database = fakeDatabase(0);
    const result = await createEntitledCandidateSession(sessionInput(), {
      ...dependencies(database, paidBilling()),
      reserveCredit: reserve,
    });

    expect(result).toMatchObject({ ok: true });
    expect(reserve).not.toHaveBeenCalled();
    expect(database.candidateSession.delete).not.toHaveBeenCalled();
    expect(database.candidateSession.count).toHaveBeenCalled();
  });
});

function sessionInput() {
  return {
    data: {
      candidateEmail: "ada@example.com",
      candidateName: "Ada",
      candidateInvitationId: null,
      consentCopyVersion: "candidate-consent-v2",
      consentedAt: now,
      interviewId: "interview_1",
      jobId: "job_1",
      organizationId: "org_1",
      resumeToken: "cs_resume",
      startedAt: now,
      status: "starting",
    },
    now,
    organizationId: "org_1",
  };
}

function paidBilling() {
  return normalizeBillingSubscription(
    {
      id: "sub_1",
      items: [
        {
          id: "item_1",
          isDefault: false,
          isFreeTrial: false,
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          planId: "plan_1",
          planName: "V1 Workspace",
          planSlug: "v1-workspace",
          status: "active",
          updatedAt: now,
        },
      ],
      status: "active",
      updatedAt: now,
    },
    { now, paidPlanSlug: "v1-workspace" },
  );
}

function dependencies(
  database: ReturnType<typeof fakeDatabase>,
  billing: ReturnType<typeof paidBilling>,
) {
  return {
    database: database as never,
    loadBilling: vi.fn(async () => billing),
    reserveCredit: vi.fn(),
  };
}

function fakeDatabase(usage: number) {
  const candidateSession = {
    count: vi.fn(async () => usage),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "candidate_session_1",
      ...data,
    })),
    delete: vi.fn(async () => ({})),
  };

  return {
    $transaction: vi.fn(
      async (
        operation: (transaction: {
          candidateSession: typeof candidateSession;
        }) => unknown,
      ) => operation({ candidateSession }),
    ),
    candidateSession,
  };
}
