import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  job: {
    create: vi.fn(),
  },
  roleIntake: {
    update: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  roleIntake: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
  prisma: prismaMock,
}));

import { consumeRoleIntake, getRoleIntakeSummary } from "./role-intake-service";

const scope = {
  clerkOrganizationId: null,
  organizationId: "org_123",
  organizationName: "Acme Talent",
  role: "recruiter" as const,
  userId: "user_123",
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.job.create.mockResolvedValue({ id: "job_123" });
  tx.roleIntake.update.mockResolvedValue({});
  tx.$queryRaw.mockResolvedValue([
    {
      id: "intake_123",
      jobId: null,
      originalFileName: "platform-engineer.pdf",
      reviewedDraft: {
        description: "Own platform reliability and incident response.",
        location: "Paris",
        title: "Platform Engineer",
      },
      status: "ready_for_review",
    },
  ]);
});

describe("consumeRoleIntake", () => {
  it("does not expose private role-intake content to viewers", async () => {
    await expect(
      getRoleIntakeSummary({ ...scope, role: "viewer" }, "intake_123"),
    ).resolves.toEqual({
      error: "Only recruiters, admins, and owners can view an imported role brief.",
      ok: false,
    });
    expect(prismaMock.roleIntake.findFirst).not.toHaveBeenCalled();
  });

  it("creates one job with the approved fields and file provenance", async () => {
    const result = await consumeRoleIntake(scope, "intake_123");

    expect(result).toEqual({ ok: true, value: { jobId: "job_123" } });
    expect(tx.job.create).toHaveBeenCalledWith({
      data: {
        description: "Own platform reliability and incident response.",
        location: "Paris",
        organizationId: "org_123",
        sourceAttachmentName: "platform-engineer.pdf",
        sourceExternalId: "role-intake:intake_123",
        sourceProvider: "file",
        status: "draft",
        title: "Platform Engineer",
      },
    });
    expect(tx.roleIntake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobId: "job_123", status: "consumed" }),
        where: { id: "intake_123" },
      }),
    );
  });

  it("returns the existing job instead of creating a duplicate", async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "intake_123",
        jobId: "job_existing",
        originalFileName: "platform-engineer.pdf",
        reviewedDraft: {},
        status: "consumed",
      },
    ]);

    await expect(consumeRoleIntake(scope, "intake_123")).resolves.toEqual({
      ok: true,
      value: { jobId: "job_existing" },
    });
    expect(tx.job.create).not.toHaveBeenCalled();
  });

  it("does not allow viewers to create a role from imported content", async () => {
    await expect(
      consumeRoleIntake({ ...scope, role: "viewer" }, "intake_123"),
    ).resolves.toEqual({
      error: "Only recruiters, admins, and owners can create a role from this brief.",
      ok: false,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
