import { randomUUID } from "node:crypto";

import {
  roleIntakeSummarySchema,
  type ImportedRoleDraft,
  type RoleIntakeSummary,
} from "@prelude/contracts";
import { Prisma, prisma } from "@prelude/db";

import {
  ROLE_INTAKE_MAX_ATTEMPTS,
  ROLE_INTAKE_PROCESSING_LEASE_MS,
  canManageRoleIntake,
  emptyImportedRoleDraft,
  isRoleIntakeFeatureEnabled,
  normalizeImportedRoleDraft,
  normalizeRoleIntakeWarnings,
  retryRoleIntakeAt,
  roleIntakeExpiresAt,
  validateRoleIntakeFile,
  type RoleIntakeFileInput,
} from "../../domain/role-intake-policy";
import type { CompletedOrganizationScope } from "../../domain/organization-access-policy";
import {
  RoleIntakeProcessingError,
  extractRoleIntakeDocument,
  scanRoleIntakeDocument,
  type RoleIntakeScanner,
} from "./role-intake-processor";
import {
  buildQuarantineObjectKey,
  buildSealedObjectKey,
  getRoleIntakeStorage,
  type RoleIntakeStorage,
} from "./role-intake-storage";

const SCANNER_UNAVAILABLE_ERROR = "scanner_unavailable";
const DUPLICATE_IMPORT_ERROR = "duplicate_import";
const INCOMPLETE_REVIEW_ERROR =
  "Add a role title and job description before continuing.";

type RoleIntakeRecord = Awaited<ReturnType<typeof prisma.roleIntake.findUniqueOrThrow>>;

export type RoleIntakeUploadInstruction = {
  intake: RoleIntakeSummary;
  uploadUrl: string;
};

export type RoleIntakeOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type RoleIntakeProcessResult =
  | { kind: "idle" }
  | { kind: "processed"; intakeId: string; status: string };

type RoleIntakeServiceDependencies = {
  scanner?: RoleIntakeScanner;
  storage?: RoleIntakeStorage | null;
};

/**
 * Starts a private, short-lived file intake. The browser only receives a
 * presigned PUT URL; object-store credentials and later document processing
 * remain on the server. See docs/sources/role-intake.md.
 */
export async function createRoleIntakeUpload(
  scope: CompletedOrganizationScope,
  input: RoleIntakeFileInput,
  dependencies: RoleIntakeServiceDependencies = {},
): Promise<RoleIntakeOperationResult<RoleIntakeUploadInstruction>> {
  const validation = validateRoleIntakeFile(input);
  if (!validation.ok) {
    return validation;
  }
  if (!canManageRoleIntake(scope.role)) {
    return { ok: false, error: "Only recruiters, admins, and owners can import a role brief." };
  }
  if (!isRoleIntakeFeatureEnabled()) {
    return { ok: false, error: "Role brief import is not configured for this workspace yet." };
  }

  const storage = dependencies.storage ?? getRoleIntakeStorage();
  if (!storage) {
    return { ok: false, error: "Role brief import storage is not configured yet." };
  }

  const id = randomUUID();
  const created = await prisma.roleIntake.create({
    data: {
      createdByUserId: scope.userId,
      declaredMimeType: validation.value.contentType,
      events: {
        create: {
          eventType: "role_intake_source_selected",
          metadata: { source_kind: "file" },
        },
      },
      expiresAt: roleIntakeExpiresAt(),
      id,
      organizationId: scope.organizationId,
      originalFileName: validation.value.fileName,
      quarantineObjectKey: buildQuarantineObjectKey({
        intakeId: id,
        organizationId: scope.organizationId,
      }),
      reviewedDraft: toJson(emptyImportedRoleDraft()),
      sourceKind: "file",
      status: "uploading",
    },
  });

  try {
    const uploadUrl = await storage.createUploadUrl({
      contentType: validation.value.contentType,
      key: created.quarantineObjectKey!,
    });
    return { ok: true, value: { intake: toSummary(created), uploadUrl } };
  } catch {
    await failRoleIntake(created.id, "storage_unavailable", "Prelude could not prepare a private upload.");
    return { ok: false, error: "Prelude could not prepare a private upload. Please retry." };
  }
}

/**
 * Verifies the completed direct upload before work is queued. Client-declared
 * file metadata is never trusted beyond signing: size, MIME magic and malware
 * checks are performed again by the worker.
 */
export async function finalizeRoleIntakeUpload(
  scope: CompletedOrganizationScope,
  intakeId: string,
  dependencies: RoleIntakeServiceDependencies = {},
): Promise<RoleIntakeOperationResult<RoleIntakeSummary>> {
  if (!canManageRoleIntake(scope.role)) {
    return { ok: false, error: "Only recruiters, admins, and owners can import a role brief." };
  }
  const normalizedId = intakeId.trim();
  const intake = await prisma.roleIntake.findFirst({
    where: { id: normalizedId, organizationId: scope.organizationId },
  });
  if (!intake) {
    return { ok: false, error: "This role brief could not be found." };
  }
  if (intake.status !== "uploading") {
    return { ok: true, value: toSummary(intake) };
  }
  if (!intake.quarantineObjectKey) {
    return { ok: false, error: "The private upload destination is unavailable." };
  }

  const storage = dependencies.storage ?? getRoleIntakeStorage();
  if (!storage) {
    return { ok: false, error: "Role brief import storage is not configured yet." };
  }

  let sealedObjectKey: string | null = null;
  try {
    const metadata = await storage.headObject(intake.quarantineObjectKey);
    if (
      !metadata ||
      metadata.byteSize <= 0 ||
      metadata.byteSize > 10 * 1024 * 1024 ||
      normaliseContentType(metadata.contentType) !== intake.declaredMimeType
    ) {
      await cleanupAndFailRoleIntake({
        code: "upload_metadata_invalid",
        intake,
        message: "The uploaded file did not match the selected PDF or DOCX brief.",
        storage,
      });
      return {
        ok: false,
        error: "The uploaded file did not match the selected PDF or DOCX brief.",
      };
    }

    sealedObjectKey = buildSealedObjectKey({
      intakeId: intake.id,
      organizationId: scope.organizationId,
    });
    await storage.copyObject({ fromKey: intake.quarantineObjectKey, toKey: sealedObjectKey });
    await prisma.roleIntake.update({
      data: {
        byteSize: metadata.byteSize,
        sealedObjectKey,
        status: "quarantined",
      },
      where: { id: intake.id },
    });
    await storage.deleteObject(intake.quarantineObjectKey);

    const queued = await prisma.roleIntake.update({
      data: {
        events: {
          create: [
            { eventType: "role_intake_upload_completed", metadata: {} },
            { eventType: "role_intake_scan_completed", metadata: { outcome: "queued" } },
          ],
        },
        nextAttemptAt: new Date(),
        quarantineObjectKey: null,
        status: "queued",
      },
      where: { id: intake.id },
    });
    return { ok: true, value: toSummary(queued) };
  } catch {
    await cleanupAndFailRoleIntake({
      code: "upload_finalize_failed",
      intake: { ...intake, sealedObjectKey },
      message: "Prelude could not secure this upload. Please retry with a fresh file.",
      storage,
    });
    return {
      ok: false,
      error: "Prelude could not secure this upload. Please retry with a fresh file.",
    };
  }
}

export async function getRoleIntakeSummary(
  scope: CompletedOrganizationScope,
  intakeId: string,
): Promise<RoleIntakeOperationResult<RoleIntakeSummary>> {
  if (!canManageRoleIntake(scope.role)) {
    return {
      ok: false,
      error: "Only recruiters, admins, and owners can view an imported role brief.",
    };
  }
  const intake = await prisma.roleIntake.findFirst({
    where: { id: intakeId.trim(), organizationId: scope.organizationId },
  });
  return intake
    ? { ok: true, value: toSummary(intake) }
    : { ok: false, error: "This role brief could not be found." };
}

export async function saveRoleIntakeReview(
  scope: CompletedOrganizationScope,
  input: { intakeId: string; reviewedDraft: ImportedRoleDraft },
): Promise<RoleIntakeOperationResult<RoleIntakeSummary>> {
  if (!canManageRoleIntake(scope.role)) {
    return { ok: false, error: "Only recruiters, admins, and owners can review a role brief." };
  }
  const draft = normalizeImportedRoleDraft(input.reviewedDraft);
  const intake = await prisma.roleIntake.findFirst({
    where: { id: input.intakeId.trim(), organizationId: scope.organizationId },
  });
  if (!intake || intake.status !== "ready_for_review") {
    return { ok: false, error: "This role brief is not ready to review." };
  }

  const updated = await prisma.roleIntake.update({
    data: {
      reviewedDraft: toJson(draft),
    },
    where: { id: intake.id },
  });
  return { ok: true, value: toSummary(updated) };
}

/**
 * Converts a recruiter-approved intake into exactly one Job. A row lock makes
 * repeated clicks, browser retries, and worker races idempotent.
 */
export async function consumeRoleIntake(
  scope: CompletedOrganizationScope,
  intakeId: string,
): Promise<RoleIntakeOperationResult<{ jobId: string }>> {
  if (!canManageRoleIntake(scope.role)) {
    return { ok: false, error: "Only recruiters, admins, and owners can create a role from this brief." };
  }

  const normalizedId = intakeId.trim();
  try {
    const value = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          jobId: string | null;
          originalFileName: string;
          reviewedDraft: Prisma.JsonValue;
          status: string;
        }>
      >(Prisma.sql`
        SELECT "id", "jobId", "originalFileName", "reviewedDraft", "status"
        FROM "RoleIntake"
        WHERE "id" = ${normalizedId} AND "organizationId" = ${scope.organizationId}
        FOR UPDATE
      `);
      const intake = rows[0];
      if (!intake) {
        return null;
      }
      if (intake.jobId) {
        return { jobId: intake.jobId };
      }
      if (intake.status !== "ready_for_review") {
        return null;
      }

      const draft = normalizeImportedRoleDraft(intake.reviewedDraft);
      if (!draft.title || !draft.description) {
        throw new Error(INCOMPLETE_REVIEW_ERROR);
      }
      const job = await tx.job.create({
        data: {
          description: draft.description,
          location: draft.location,
          organizationId: scope.organizationId,
          sourceAttachmentName: intake.originalFileName,
          sourceExternalId: `role-intake:${intake.id}`,
          sourceProvider: "file",
          status: "draft",
          title: draft.title,
        },
      });
      await tx.roleIntake.update({
        data: {
          events: {
            create: { eventType: "role_intake_converted", metadata: {} },
          },
          jobId: job.id,
          status: "consumed",
        },
        where: { id: intake.id },
      });
      return { jobId: job.id };
    });
    return value
      ? { ok: true, value }
      : { ok: false, error: "This role brief is not ready to create a role." };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message === INCOMPLETE_REVIEW_ERROR
          ? INCOMPLETE_REVIEW_ERROR
          : "Prelude could not create this role. Please retry.",
    };
  }
}

/** Claims one queued intake through a DB lease. It intentionally has no Redis
 * dependency: the work is sparse, retryable, and belongs to the same durable
 * transaction boundary as the intake record. */
export async function processNextRoleIntake(
  dependencies: RoleIntakeServiceDependencies = {},
): Promise<RoleIntakeProcessResult> {
  const storage = dependencies.storage ?? getRoleIntakeStorage();
  if (!storage) {
    return { kind: "idle" };
  }

  const now = new Date();
  const candidate = await prisma.roleIntake.findFirst({
    orderBy: { nextAttemptAt: "asc" },
    where: {
      expiresAt: { gt: now },
      nextAttemptAt: { lte: now },
      status: "queued",
    },
  });
  if (!candidate) {
    return { kind: "idle" };
  }

  const claimed = await prisma.roleIntake.updateMany({
    data: {
      attemptCount: { increment: 1 },
      nextAttemptAt: null,
      processingLeaseExpiresAt: new Date(now.getTime() + ROLE_INTAKE_PROCESSING_LEASE_MS),
      processingStartedAt: now,
      status: "processing",
    },
    where: { id: candidate.id, status: "queued" },
  });
  if (claimed.count === 0) {
    return { kind: "idle" };
  }

  const intake = await prisma.roleIntake.findUniqueOrThrow({ where: { id: candidate.id } });
  if (!intake.sealedObjectKey) {
    await failRoleIntake(intake.id, "sealed_object_missing", "The private upload is no longer available.");
    return { kind: "processed", intakeId: intake.id, status: "failed" };
  }

  try {
    const file = await storage.getObjectBytes(intake.sealedObjectKey);
    const scanner = dependencies.scanner ?? { scan: scanRoleIntakeDocument };
    const scan = await scanner.scan(file);
    if (scan.kind === "unavailable") {
      await retryOrFailUnavailableScanner(intake, scan.reason);
      return { kind: "processed", intakeId: intake.id, status: "queued" };
    }
    if (scan.kind === "infected") {
      await cleanupAndFailRoleIntake({
        code: "malware_detected",
        intake,
        message: "The document could not be imported safely.",
        storage,
      });
      return { kind: "processed", intakeId: intake.id, status: "failed" };
    }

    const extraction = await extractRoleIntakeDocument(file);
    const existing = await prisma.roleIntake.findFirst({
      select: { id: true },
      where: {
        id: { not: intake.id },
        organizationId: intake.organizationId,
        sha256: extraction.sha256,
        status: { in: ["ready_for_review", "consumed"] },
      },
    });
    if (existing) {
      await cleanupAndFailRoleIntake({
        code: DUPLICATE_IMPORT_ERROR,
        intake,
        message: "This exact role brief has already been imported in this workspace.",
        storage,
        telemetryEvent: "role_intake_duplicate_detected",
      });
      return { kind: "processed", intakeId: intake.id, status: "failed" };
    }

    await storage.deleteObject(intake.sealedObjectKey);
    await prisma.roleIntake.update({
      data: {
        cleanedUpAt: new Date(),
        detectedMimeType: extraction.detectedMimeType,
        events: {
          create: [
            { eventType: "role_intake_scan_completed", metadata: { outcome: "clean" } },
            { eventType: "role_intake_extraction_completed", metadata: {} },
            { eventType: "role_intake_object_deleted", metadata: { reason: "extracted" } },
          ],
        },
        extractedDraft: toJson(extraction.draft),
        lastErrorCode: null,
        lastErrorSummary: null,
        parserVersion: extraction.parserVersion,
        processingLeaseExpiresAt: null,
        reviewedDraft: toJson(extraction.draft),
        scannerVersion: scan.version,
        sealedObjectKey: null,
        sha256: extraction.sha256,
        status: "ready_for_review",
        warnings: toJson(extraction.warnings),
      },
      where: { id: intake.id },
    });
    return { kind: "processed", intakeId: intake.id, status: "ready_for_review" };
  } catch (error) {
    if (isDuplicateRoleIntakeError(error)) {
      await cleanupAndFailRoleIntake({
        code: DUPLICATE_IMPORT_ERROR,
        intake,
        message: "This exact role brief has already been imported in this workspace.",
        storage,
        telemetryEvent: "role_intake_duplicate_detected",
      });
      return { kind: "processed", intakeId: intake.id, status: "failed" };
    }
    const message =
      error instanceof RoleIntakeProcessingError
        ? error.message
        : "Prelude could not read this document safely.";
    const code = error instanceof RoleIntakeProcessingError ? error.code : "processing_failed";
    await cleanupAndFailRoleIntake({ code, intake, message, storage });
    return { kind: "processed", intakeId: intake.id, status: "failed" };
  }
}

/** Reclaims abandoned/stalled work and enforces the 24-hour raw-file window. */
export async function reconcileRoleIntakes(
  dependencies: RoleIntakeServiceDependencies = {},
): Promise<{ expired: number; reclaimed: number }> {
  const storage = dependencies.storage ?? getRoleIntakeStorage();
  const now = new Date();
  const reclaimed = await prisma.roleIntake.updateMany({
    data: {
      nextAttemptAt: now,
      processingLeaseExpiresAt: null,
      status: "queued",
    },
    where: { processingLeaseExpiresAt: { lt: now }, status: "processing" },
  });
  await prisma.roleIntake.updateMany({
    data: { nextAttemptAt: now, status: "queued" },
    where: { sealedObjectKey: { not: null }, status: "quarantined" },
  });

  const expired = await prisma.roleIntake.findMany({
    take: 100,
    where: {
      expiresAt: { lte: now },
      status: { notIn: ["consumed", "deleted"] },
    },
  });
  for (const intake of expired) {
    const deleted = storage
      ? await deleteStoredRoleIntakeObjects(storage, intake)
          .then(() => true)
          .catch(() => false)
      : false;
    await prisma.roleIntake.update({
      data: {
        cleanupRequestedAt: now,
        cleanedUpAt: deleted ? now : null,
        events: deleted
          ? { create: { eventType: "role_intake_object_deleted", metadata: { reason: "expired" } } }
          : undefined,
        quarantineObjectKey: deleted ? null : intake.quarantineObjectKey,
        sealedObjectKey: deleted ? null : intake.sealedObjectKey,
        status: "expired",
      },
      where: { id: intake.id },
    });
  }
  return { expired: expired.length, reclaimed: reclaimed.count };
}

async function retryOrFailUnavailableScanner(
  intake: RoleIntakeRecord,
  reason: string,
): Promise<void> {
  if (intake.attemptCount >= ROLE_INTAKE_MAX_ATTEMPTS) {
    await failRoleIntake(
      intake.id,
      SCANNER_UNAVAILABLE_ERROR,
      "Prelude could not verify this document safely. Please retry later or start from a manual brief.",
    );
    return;
  }
  await prisma.roleIntake.update({
    data: {
      lastErrorCode: SCANNER_UNAVAILABLE_ERROR,
      lastErrorSummary: reason,
      nextAttemptAt: retryRoleIntakeAt(intake.attemptCount),
      processingLeaseExpiresAt: null,
      status: "queued",
    },
    where: { id: intake.id },
  });
}

async function cleanupAndFailRoleIntake({
  code,
  intake,
  message,
  storage,
  telemetryEvent,
}: {
  code: string;
  intake: RoleIntakeRecord;
  message: string;
  storage: RoleIntakeStorage;
  telemetryEvent?: string;
}): Promise<void> {
  const deleted = await deleteStoredRoleIntakeObjects(storage, intake)
    .then(() => true)
    .catch(() => false);
  await prisma.roleIntake.update({
    data: {
      cleanedUpAt: deleted ? new Date() : null,
      cleanupRequestedAt: new Date(),
      events: {
        create: [
          ...(telemetryEvent ? [{ eventType: telemetryEvent, metadata: {} }] : []),
          ...(telemetryEvent
            ? deleted
              ? [{ eventType: "role_intake_object_deleted", metadata: { reason: "failed" } }]
              : []
            : deleted
              ? [{ eventType: "role_intake_object_deleted", metadata: { reason: "failed" } }]
            : []),
        ],
      },
      lastErrorCode: code,
      lastErrorSummary: message,
      processingLeaseExpiresAt: null,
      quarantineObjectKey: deleted ? null : intake.quarantineObjectKey,
      sealedObjectKey: deleted ? null : intake.sealedObjectKey,
      status: "failed",
    },
    where: { id: intake.id },
  });
}

async function failRoleIntake(id: string, code: string, summary: string): Promise<void> {
  await prisma.roleIntake.update({
    data: {
      lastErrorCode: code,
      lastErrorSummary: summary,
      processingLeaseExpiresAt: null,
      status: "failed",
    },
    where: { id },
  });
}

async function deleteStoredRoleIntakeObjects(
  storage: RoleIntakeStorage,
  intake: Pick<RoleIntakeRecord, "quarantineObjectKey" | "sealedObjectKey">,
): Promise<void> {
  await Promise.all(
    [intake.quarantineObjectKey, intake.sealedObjectKey]
      .filter((key): key is string => Boolean(key))
      .map((key) => storage.deleteObject(key)),
  );
}

function toSummary(intake: RoleIntakeRecord): RoleIntakeSummary {
  return roleIntakeSummarySchema.parse({
    expiresAt: intake.expiresAt.toISOString(),
    id: intake.id,
    originalFileName: intake.originalFileName,
    reviewedDraft: normalizeImportedRoleDraft(intake.reviewedDraft),
    sourceKind: intake.sourceKind,
    status: intake.status,
    warnings: normalizeRoleIntakeWarnings(intake.warnings),
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normaliseContentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isDuplicateRoleIntakeError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
