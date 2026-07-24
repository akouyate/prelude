import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
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
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
  prisma: prismaMock,
}));

import {
  createRoleIntakeUrl,
  processNextRoleIntake,
  saveRoleIntakeReview,
} from "./role-intake-service";

const scope = {
  clerkOrganizationId: null,
  organizationId: "org_123",
  organizationName: "Acme Talent",
  role: "recruiter" as const,
  userId: "user_123",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ROLE_INTAKE_ENABLED = "1";
  prismaMock.roleIntake.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    roleIntake({ ...data, id: "intake_123" }),
  );
  prismaMock.roleIntake.update.mockImplementation(async ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) =>
    roleIntake({ ...data, id: where.id }),
  );
});

describe("public URL role intake service", () => {
  it("creates a private queued intake and returns the existing one for the same normalized URL", async () => {
    prismaMock.roleIntake.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        roleIntake({
          sourceIdentity: "existing_identity",
          submittedUrl: "https://careers.example.com/jobs/123",
        }),
      );

    const created = await createRoleIntakeUrl(
      scope,
      "https://careers.example.com/jobs/123?utm_source=campaign",
    );

    expect(created).toMatchObject({
      ok: true,
      value: {
        source: expect.objectContaining({ submittedUrl: "https://careers.example.com/jobs/123" }),
        sourceKind: "url",
        status: "queued",
      },
    });
    expect(prismaMock.roleIntake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceKind: "url",
          status: "queued",
          submittedUrl: "https://careers.example.com/jobs/123",
        }),
      }),
    );

    const repeated = await createRoleIntakeUrl(scope, "https://careers.example.com/jobs/123");

    expect(repeated).toMatchObject({ ok: true, value: { id: "intake_123" } });
    expect(prismaMock.roleIntake.create).toHaveBeenCalledTimes(1);
  });

  it("processes a queued URL source without R2 storage and persists only extracted provenance", async () => {
    prismaMock.roleIntake.findFirst
      .mockResolvedValueOnce({ id: "intake_123" })
      .mockResolvedValueOnce(null);
    prismaMock.roleIntake.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        attemptCount: 1,
        nextAttemptAt: new Date(),
        sourceIdentity: "initial_identity",
        status: "processing",
        submittedUrl: "https://careers.example.com/jobs/123",
      }),
    );

    const result = await processNextRoleIntake({
      storage: null,
      urlImporter: async () => ({
        canonicalUrl: "https://careers.example.com/jobs/123",
        contentHash: "not-persisted",
        draft: {
          description: "Own customer onboarding, retention, and feedback workflows across the B2B product.",
          location: "Paris",
          title: "Customer Success Manager",
        },
        extractorVersion: "static-html-v1",
        fetchedAt: new Date("2026-07-17T12:00:00.000Z"),
        fieldSources: {
          description: "job_posting_json_ld",
          location: "job_posting_json_ld",
          title: "job_posting_json_ld",
        },
        sourceHost: "careers.example.com",
        warnings: [],
      }),
    });

    expect(result).toEqual({ kind: "processed", intakeId: "intake_123", status: "ready_for_review" });
    expect(prismaMock.roleIntake.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canonicalUrl: "https://careers.example.com/jobs/123",
          sourceMetadata: {
            extractor_version: "static-html-v1",
            fetched_at: "2026-07-17T12:00:00.000Z",
            field_sources: {
              description: "job_posting_json_ld",
              location: "job_posting_json_ld",
              title: "job_posting_json_ld",
            },
            source_host: "careers.example.com",
          },
          status: "ready_for_review",
        }),
      }),
    );
    expect(JSON.stringify(prismaMock.roleIntake.update.mock.calls)).not.toContain("not-persisted");
  });

  it("refuses a stale review version instead of overwriting another recruiter's edits", async () => {
    prismaMock.roleIntake.findFirst.mockResolvedValue(
      roleIntake({
        reviewVersion: 2,
        reviewedDraft: {
          description: "Current recruiter review.",
          location: null,
          title: "Product Designer",
        },
        status: "ready_for_review",
      }),
    );
    prismaMock.roleIntake.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      saveRoleIntakeReview(scope, {
        expectedReviewVersion: 1,
        intakeId: "intake_123",
        reviewedDraft: {
          description: "Stale browser review.",
          location: null,
          title: "Product Designer",
        },
      }),
    ).resolves.toEqual({
      error: "This review changed in another browser. Refresh it before saving your edits.",
      ok: false,
    });
  });
});

function roleIntake(overrides: Record<string, unknown> = {}) {
  return {
    attemptCount: 0,
    canonicalUrl: null,
    cleanedUpAt: null,
    cleanupRequestedAt: null,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    createdByUserId: "user_123",
    declaredMimeType: "text/html",
    detectedMimeType: null,
    duplicateOfIntakeId: null,
    events: [],
    expiresAt: new Date("2026-07-18T12:00:00.000Z"),
    extractedDraft: {},
    id: "intake_123",
    jobId: null,
    lastErrorCode: null,
    lastErrorSummary: null,
    nextAttemptAt: null,
    organizationId: "org_123",
    originalFileName: "careers.example.com",
    parserVersion: null,
    processingLeaseExpiresAt: null,
    processingStartedAt: null,
    quarantineObjectKey: null,
    reviewVersion: 0,
    reviewedAt: null,
    reviewedByUserId: null,
    reviewedDraft: {},
    scannerVersion: null,
    sealedObjectKey: null,
    sha256: null,
    sourceIdentity: "source_identity",
    sourceKind: "url",
    sourceMetadata: {},
    status: "queued",
    submittedUrl: "https://careers.example.com/jobs/123",
    updatedAt: new Date("2026-07-17T12:00:00.000Z"),
    warnings: [],
    ...overrides,
  };
}
