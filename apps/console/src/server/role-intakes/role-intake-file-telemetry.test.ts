import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  job: { create: vi.fn() },
  roleIntake: { update: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
    callback(tx),
  ),
  roleIntake: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  },
  prisma: prismaMock,
}));

import {
  consumeRoleIntake,
  createRoleIntakeUpload,
  processNextRoleIntake,
  reconcileRoleIntakes,
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
  prismaMock.roleIntake.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) =>
      roleIntake({ ...data, id: "intake_123" }),
  );
  prismaMock.roleIntake.update.mockImplementation(
    async ({
      data,
      where,
    }: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => roleIntake({ ...data, id: where.id }),
  );
  prismaMock.roleIntake.updateMany.mockResolvedValue({ count: 1 });
  tx.job.create.mockResolvedValue({ id: "job_123" });
  tx.roleIntake.update.mockResolvedValue({});
});

describe("role intake file telemetry", () => {
  it("records the role builder entry point when a file source is selected", async () => {
    const storage = storageFor(Buffer.alloc(0));
    storage.createUploadUrl.mockResolvedValue("https://upload.example.test");

    await createRoleIntakeUpload(
      scope,
      {
        byteSize: 512,
        contentType: "application/pdf",
        fileName: "role.pdf",
      },
      { storage },
    );

    expect(prismaMock.roleIntake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          events: {
            create: {
              eventType: "role_intake_source_selected",
              metadata: {
                entry_point: "role_builder",
                source_kind: "file",
              },
            },
          },
        }),
      }),
    );
  });

  it("records privacy-safe structural metrics for a clean file", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst
      .mockResolvedValueOnce({ id: "intake_123" })
      .mockResolvedValueOnce(null);
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        processingStartedAt: new Date(),
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );
    const storage = storageFor(input);

    await expect(
      processNextRoleIntake({
        scanner: {
          scan: vi
            .fn()
            .mockResolvedValue({ kind: "clean", version: "clamav-test" }),
        },
        storage,
      }),
    ).resolves.toEqual({
      intakeId: "intake_123",
      kind: "processed",
      status: "ready_for_review",
    });

    const events = eventsFromLastUpdate();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "role_intake_upload_completed",
          metadata: {
            detected_mime: "application/pdf",
            signature_valid: true,
            size_bucket: expect.any(String),
          },
        }),
        expect.objectContaining({
          eventType: "role_intake_scan_completed",
          metadata: { duration_ms: expect.any(Number), outcome: "clean" },
        }),
        expect.objectContaining({
          eventType: "role_intake_extraction_completed",
          metadata: {
            duration_ms: expect.any(Number),
            outcome: "ready_for_review",
            page_bucket: "1",
            parser_version: "pdfjs-dist-6.1.200",
            text_length_bucket: expect.any(String),
            warning_codes: [],
          },
        }),
        {
          eventType: "role_intake_object_deleted",
          metadata: { reason: "extracted" },
        },
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("Product Manager");
    expect(JSON.stringify(events)).not.toContain("sealed/intake_123");
  }, 15_000);

  it("records a deterministic manual fallback without fabricated fields", async () => {
    const input = createPdf("");
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );
    const storage = storageFor(input);

    await expect(
      processNextRoleIntake({
        scanner: {
          scan: vi
            .fn()
            .mockResolvedValue({ kind: "clean", version: "clamav-test" }),
        },
        storage,
      }),
    ).resolves.toEqual({
      intakeId: "intake_123",
      kind: "processed",
      status: "failed",
    });

    const events = eventsFromLastUpdate();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "role_intake_upload_completed",
          metadata: expect.objectContaining({ signature_valid: true }),
        }),
        expect.objectContaining({
          eventType: "role_intake_extraction_completed",
          metadata: expect.objectContaining({
            outcome: "manual_fallback",
            text_length_bucket: "0",
          }),
        }),
        {
          eventType: "role_intake_object_deleted",
          metadata: { reason: "failed" },
        },
      ]),
    );
    expect(prismaMock.roleIntake.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
        }),
      }),
    );
    const lastFailureData = prismaMock.roleIntake.update.mock.calls.at(-1)?.[0]
      ?.data as Record<string, unknown>;
    expect(lastFailureData).not.toHaveProperty("extractedDraft");
  }, 15_000);

  it("records scanner unavailability before scheduling a bounded retry", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );

    await expect(
      processNextRoleIntake({
        scanner: {
          scan: vi
            .fn()
            .mockResolvedValue({
              kind: "unavailable",
              reason: "scanner starting",
            }),
        },
        storage: storageFor(input),
      }),
    ).resolves.toEqual({
      intakeId: "intake_123",
      kind: "processed",
      status: "queued",
    });

    expect(eventsFromLastUpdate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "role_intake_upload_completed" }),
        expect.objectContaining({
          eventType: "role_intake_scan_completed",
          metadata: { duration_ms: expect.any(Number), outcome: "unavailable" },
        }),
      ]),
    );
  });

  it("deletes the raw object when the final scanner attempt is unavailable", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        attemptCount: 3,
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );
    const storage = storageFor(input);

    await processNextRoleIntake({
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ kind: "unavailable", reason: "scanner unavailable" }),
      },
      storage,
    });

    expect(storage.deleteObject).toHaveBeenCalledWith("sealed/intake_123");
    expect(eventsFromLastUpdate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "role_intake_scan_completed",
          metadata: { duration_ms: expect.any(Number), outcome: "unavailable" },
        }),
        {
          eventType: "role_intake_object_deleted",
          metadata: { reason: "failed" },
        },
      ]),
    );
    expect(prismaMock.roleIntake.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("records an infected scan and deletes the raw object without extraction", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );

    await processNextRoleIntake({
      scanner: {
        scan: vi.fn().mockResolvedValue({
          kind: "infected",
          signature: "not-persisted",
          version: "clamav-test",
        }),
      },
      storage: storageFor(input),
    });

    const events = eventsFromLastUpdate();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "role_intake_scan_completed",
          metadata: { duration_ms: expect.any(Number), outcome: "infected" },
        }),
        {
          eventType: "role_intake_object_deleted",
          metadata: { reason: "failed" },
        },
      ]),
    );
    expect(
      events.some(
        (event) => event.eventType === "role_intake_extraction_completed",
      ),
    ).toBe(false);
    expect(JSON.stringify(events)).not.toContain("not-persisted");
  });

  it("does not claim deletion when object-store verification still finds the raw file", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );
    const storage = storageFor(input);
    storage.headObject.mockResolvedValue({
      byteSize: input.length,
      contentType: "application/pdf",
    });

    await processNextRoleIntake({
      scanner: {
        scan: vi.fn().mockResolvedValue({
          kind: "infected",
          signature: null,
          version: "clamav-test",
        }),
      },
      storage,
    });

    expect(
      eventsFromLastUpdate().some(
        (event) => event.eventType === "role_intake_object_deleted",
      ),
    ).toBe(false);
    expect(prismaMock.roleIntake.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cleanedUpAt: null,
          sealedObjectKey: "sealed/intake_123",
        }),
      }),
    );
  });

  it("rejects an invalid signature before the scanner and records the failure structurally", async () => {
    const input = Buffer.from("not a PDF or DOCX");
    const scan = vi.fn();
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );

    await processNextRoleIntake({
      scanner: { scan },
      storage: storageFor(input),
    });

    expect(scan).not.toHaveBeenCalled();
    expect(eventsFromLastUpdate()).toEqual(
      expect.arrayContaining([
        {
          eventType: "role_intake_upload_completed",
          metadata: {
            detected_mime: "unknown",
            signature_valid: false,
            size_bucket: "0-100kb",
          },
        },
        expect.objectContaining({
          eventType: "role_intake_extraction_completed",
          metadata: expect.objectContaining({
            outcome: "failed",
            parser_version: "unknown",
            warning_codes: ["unsupported_document"],
          }),
        }),
      ]),
    );
  });

  it("does not mislabel ordinary review edits as the no-text fallback flow", async () => {
    const intake = roleIntake({
      extractedDraft: {
        description: "Own product discovery and delivery.",
        location: null,
        title: null,
      },
      reviewedDraft: {
        description: "Own product discovery and delivery.",
        location: null,
        title: null,
      },
      status: "ready_for_review",
    });
    prismaMock.roleIntake.findFirst.mockResolvedValue(intake);
    prismaMock.roleIntake.update.mockResolvedValue(
      roleIntake({
        reviewedDraft: {
          description: "Own product discovery and delivery.",
          location: "Paris",
          title: "Product Manager",
        },
        status: "ready_for_review",
      }),
    );

    await saveRoleIntakeReview(scope, {
      expectedReviewVersion: 0,
      intakeId: "intake_123",
      reviewedDraft: {
        description: "Own product discovery and delivery.",
        location: "Paris",
        title: "Product Manager",
      },
    });

    expect(prismaMock.roleIntake.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          events: {
            create: expect.objectContaining({
              eventType: "role_intake_review_submitted",
              metadata: {
                changed_field_names: ["title", "location"],
                elapsed_ms: expect.any(Number),
                manual_fallback_used: false,
              },
            }),
          },
        },
      }),
    );
  });

  it("records a failed scan event when the scanner throws", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst.mockResolvedValueOnce({ id: "intake_123" });
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );

    await processNextRoleIntake({
      scanner: {
        scan: vi.fn().mockRejectedValue(new Error("private scanner detail")),
      },
      storage: storageFor(input),
    });

    expect(eventsFromLastUpdate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "role_intake_scan_completed",
          metadata: {
            duration_ms: expect.any(Number),
            outcome: "failed",
          },
        }),
      ]),
    );
    expect(JSON.stringify(eventsFromLastUpdate())).not.toContain(
      "private scanner detail",
    );
  });

  it("records a failed extraction event when an extractor throws unexpectedly", async () => {
    const input = createPdf("Job Title: Product Manager");
    prismaMock.roleIntake.findFirst
      .mockResolvedValueOnce({ id: "intake_123" })
      .mockResolvedValueOnce(null);
    prismaMock.roleIntake.findUniqueOrThrow.mockResolvedValue(
      roleIntake({
        byteSize: input.length,
        sealedObjectKey: "sealed/intake_123",
        status: "processing",
      }),
    );

    await processNextRoleIntake({
      extractor: vi.fn().mockRejectedValue(new Error("private parser detail")),
      scanner: {
        scan: vi
          .fn()
          .mockResolvedValue({ kind: "clean", version: "clamav-test" }),
      },
      storage: storageFor(input),
    });

    expect(eventsFromLastUpdate()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "role_intake_extraction_completed",
          metadata: expect.objectContaining({
            outcome: "failed",
            parser_version: "unknown",
            warning_codes: ["processing_failed"],
          }),
        }),
      ]),
    );
    expect(JSON.stringify(eventsFromLastUpdate())).not.toContain(
      "private parser detail",
    );
  });

  it("retries failed raw-object cleanup without moving the original SLA start", async () => {
    const cleanupRequestedAt = new Date("2026-07-22T10:00:00.000Z");
    prismaMock.roleIntake.findMany
      .mockResolvedValueOnce([
        roleIntake({
          cleanedUpAt: null,
          cleanupRequestedAt,
          expiresAt: new Date("2099-07-25T10:00:00.000Z"),
          sealedObjectKey: "sealed/intake_123",
          status: "failed",
        }),
      ])
      .mockResolvedValueOnce([]);
    const storage = storageFor(Buffer.alloc(0));

    await reconcileRoleIntakes({ storage });

    expect(storage.deleteObject).toHaveBeenCalledWith("sealed/intake_123");
    expect(prismaMock.roleIntake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cleanedUpAt: expect.any(Date),
          sealedObjectKey: null,
        }),
        where: { id: "intake_123" },
      }),
    );
    const updateData = prismaMock.roleIntake.update.mock.calls.at(-1)?.[0]
      ?.data as Record<string, unknown>;
    expect(updateData).not.toHaveProperty("cleanupRequestedAt");
  });

  it("records successful conversion latency in the same idempotent transaction", async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        canonicalUrl: null,
        createdAt: new Date("2026-07-24T10:00:00.000Z"),
        id: "intake_123",
        jobId: null,
        originalFileName: "role.pdf",
        reviewedDraft: {
          description: "Own product discovery and delivery.",
          location: "Paris",
          title: "Product Manager",
        },
        sourceKind: "file",
        status: "ready_for_review",
      },
    ]);

    await expect(consumeRoleIntake(scope, "intake_123")).resolves.toEqual({
      ok: true,
      value: { jobId: "job_123" },
    });

    expect(tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originRoleIntakeId: "intake_123",
        }),
      }),
    );
    expect(tx.roleIntake.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          events: {
            create: expect.objectContaining({
              eventType: "role_intake_converted",
              metadata: {
                elapsed_ms: expect.any(Number),
                outcome: "converted",
              },
            }),
          },
        }),
      }),
    );
  });

  it("records a structural failed conversion attempt after transaction rollback", async () => {
    tx.$queryRaw.mockResolvedValue([
      {
        canonicalUrl: null,
        createdAt: new Date("2026-07-24T10:00:00.000Z"),
        id: "intake_123",
        jobId: null,
        originalFileName: "role.pdf",
        reviewedDraft: {
          description: "Own product discovery and delivery.",
          location: "Paris",
          title: "Product Manager",
        },
        sourceKind: "file",
        status: "ready_for_review",
      },
    ]);
    tx.job.create.mockRejectedValueOnce(new Error("private database detail"));
    prismaMock.roleIntake.findFirst.mockReset().mockResolvedValueOnce(
      roleIntake({ status: "ready_for_review" }),
    );

    await expect(consumeRoleIntake(scope, "intake_123")).resolves.toEqual({
      error: "Prelude could not create this role. Please retry.",
      ok: false,
    });

    expect(prismaMock.roleIntake.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          events: {
            create: expect.objectContaining({
              eventType: "role_intake_converted",
              metadata: {
                elapsed_ms: expect.any(Number),
                outcome: "failed",
              },
            }),
          },
        },
        where: { id: "intake_123" },
      }),
    );
    expect(JSON.stringify(eventsFromLastUpdate())).not.toContain(
      "private database detail",
    );
  });
});

function eventsFromLastUpdate(): Array<{
  eventType: string;
  metadata: Record<string, unknown>;
}> {
  const calls = prismaMock.roleIntake.update.mock.calls;
  const data = calls.at(-1)?.[0]?.data as {
    events?: {
      create?: Array<{ eventType: string; metadata: Record<string, unknown> }>;
    };
  };
  return data.events?.create ?? [];
}

function roleIntake(overrides: Record<string, unknown> = {}) {
  return {
    attemptCount: 1,
    byteSize: 512,
    canonicalUrl: null,
    cleanedUpAt: null,
    cleanupRequestedAt: null,
    createdAt: new Date("2026-07-24T10:00:00.000Z"),
    createdByUserId: "user_123",
    declaredMimeType: "application/pdf",
    detectedMimeType: null,
    duplicateOfIntakeId: null,
    events: [],
    expiresAt: new Date("2026-07-25T10:00:00.000Z"),
    extractedDraft: {},
    id: "intake_123",
    jobId: null,
    lastErrorCode: null,
    lastErrorSummary: null,
    nextAttemptAt: null,
    organizationId: "org_123",
    originalFileName: "role.pdf",
    parserVersion: null,
    processingLeaseExpiresAt: null,
    processingStartedAt: null,
    quarantineObjectKey: null,
    reviewVersion: 0,
    reviewedAt: null,
    reviewedByUserId: null,
    reviewedDraft: {},
    scannerVersion: null,
    sealedObjectKey: "sealed/intake_123",
    sha256: null,
    sourceIdentity: null,
    sourceKind: "file",
    sourceMetadata: {},
    status: "queued",
    submittedUrl: null,
    updatedAt: new Date("2026-07-24T10:00:00.000Z"),
    warnings: [],
    ...overrides,
  };
}

function storageFor(input: Buffer) {
  return {
    copyObject: vi.fn(),
    createUploadUrl: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    getObjectBytes: vi.fn().mockResolvedValue(input),
    headObject: vi.fn(),
  };
}

function createPdf(text: string): Buffer {
  const stream = text
    ? `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, "\\$&")}) Tj\nET\n`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "utf8");
}
