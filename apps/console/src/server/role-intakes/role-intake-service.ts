import { randomUUID } from "node:crypto";

import {
  roleIntakeSummarySchema,
  type ImportedRoleDraft,
  type RoleIntakeSummary,
  type RoleIntakeSourceProvenance,
} from "@prelude/contracts";
import { Prisma, prisma } from "@prelude/db";

import {
  ROLE_INTAKE_MAX_ATTEMPTS,
  ROLE_INTAKE_PROCESSING_LEASE_MS,
  ROLE_INTAKE_URL_MAX_ATTEMPTS,
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
import {
  RoleIntakeUrlImportError,
  createRoleIntakeUrlIdentity,
  fetchRoleIntakePublicPage,
  normalizeRoleIntakeUrl,
  type RoleIntakePublicPage,
} from "./role-intake-url-importer";

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
  urlImporter?: (source: string) => Promise<RoleIntakePublicPage>;
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
 * Queues one public job URL without retrieving it in the request cycle. The
 * worker owns all network access, so a server action never inherits browser
 * credentials or becomes an implicit web proxy.
 */
export async function createRoleIntakeUrl(
  scope: CompletedOrganizationScope,
  source: string,
): Promise<RoleIntakeOperationResult<RoleIntakeSummary>> {
  if (!canManageRoleIntake(scope.role)) {
    return { ok: false, error: "Only recruiters, admins, and owners can import a public job URL." };
  }
  if (!isRoleIntakeFeatureEnabled()) {
    return { ok: false, error: "Role import is not configured for this workspace yet." };
  }

  let url: URL;
  try {
    url = normalizeRoleIntakeUrl(source);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof RoleIntakeUrlImportError
          ? error.message
          : "Enter a valid public HTTPS job URL.",
    };
  }
  const sourceIdentity = createRoleIntakeUrlIdentity(url);
  const existing = await prisma.roleIntake.findFirst({
    where: { organizationId: scope.organizationId, sourceIdentity },
  });
  if (existing) {
    return { ok: true, value: toSummary(existing) };
  }

  try {
    const created = await prisma.roleIntake.create({
      data: {
        createdByUserId: scope.userId,
        declaredMimeType: "text/html",
        events: {
          create: {
            eventType: "role_intake_source_selected",
            metadata: { source_kind: "url" },
          },
        },
        expiresAt: roleIntakeExpiresAt(),
        originalFileName: url.hostname,
        organizationId: scope.organizationId,
        reviewedDraft: toJson(emptyImportedRoleDraft()),
        sourceIdentity,
        sourceKind: "url",
        sourceMetadata: toJson({}),
        status: "queued",
        submittedUrl: url.toString(),
        nextAttemptAt: new Date(),
      },
    });
    return { ok: true, value: toSummary(created) };
  } catch (error) {
    if (isDuplicateRoleIntakeError(error)) {
      const duplicate = await prisma.roleIntake.findFirst({
        where: { organizationId: scope.organizationId, sourceIdentity },
      });
      if (duplicate) {
        return { ok: true, value: toSummary(duplicate) };
      }
    }
    return { ok: false, error: "Prelude could not prepare this public job URL. Please retry." };
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
  input: {
    expectedReviewVersion: number;
    intakeId: string;
    reviewedDraft: ImportedRoleDraft;
  },
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
  if (!Number.isInteger(input.expectedReviewVersion) || input.expectedReviewVersion < 0) {
    return { ok: false, error: "This role brief needs to be refreshed before saving." };
  }

  const saved = await prisma.roleIntake.updateMany({
    data: {
      reviewVersion: { increment: 1 },
      reviewedAt: new Date(),
      reviewedByUserId: scope.userId,
      reviewedDraft: toJson(draft),
    },
    where: { id: intake.id, reviewVersion: input.expectedReviewVersion },
  });
  if (saved.count !== 1) {
    return {
      ok: false,
      error: "This review changed in another browser. Refresh it before saving your edits.",
    };
  }
  const updated = await prisma.roleIntake.update({
    data: {
      events: {
        create: {
          eventType: "role_intake_review_updated",
          metadata: { changed_fields: changedRoleDraftFields(intake.reviewedDraft, draft) },
        },
      },
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
          canonicalUrl: string | null;
          originalFileName: string;
          reviewedDraft: Prisma.JsonValue;
          sourceKind: string;
          status: string;
        }>
      >(Prisma.sql`
        SELECT "id", "jobId", "canonicalUrl", "originalFileName", "reviewedDraft", "sourceKind", "status"
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
          sourceAttachmentName: intake.sourceKind === "file" ? intake.originalFileName : null,
          sourceExternalId:
            intake.sourceKind === "url" && intake.canonicalUrl
              ? intake.canonicalUrl
              : `role-intake:${intake.id}`,
          sourceProvider: intake.sourceKind === "url" ? "url" : "file",
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
  const now = new Date();
  const candidate = await prisma.roleIntake.findFirst({
    orderBy: { nextAttemptAt: "asc" },
    where: {
      expiresAt: { gt: now },
      nextAttemptAt: { lte: now },
      ...(storage ? {} : { sourceKind: "url" }),
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
  if (intake.sourceKind === "url") {
    return processRoleIntakeUrl(intake, dependencies);
  }
  if (!storage) {
    return { kind: "idle" };
  }
  if (!intake.sealedObjectKey) {
    await failRoleIntake(intake.id, "sealed_object_missing", "The private upload is no longer available.");
    return { kind: "processed", intakeId: intake.id, status: "failed" };
  }

  let extractedHash: string | undefined;
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
    extractedHash = extraction.sha256;
    const existing = await prisma.roleIntake.findFirst({
      select: { id: true, status: true },
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
        duplicateOfIntakeId:
          existing.status === "consumed" ? undefined : existing.id,
        intake,
        message:
          existing.status === "consumed"
            ? "This exact role brief has already created a role in this workspace."
            : "This exact role brief is already being processed in this workspace.",
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
    if (isDuplicateRoleIntakeError(error) && extractedHash) {
      const existing = await prisma.roleIntake.findFirst({
        select: { id: true, status: true },
        where: {
          id: { not: intake.id },
          organizationId: intake.organizationId,
          sha256: extractedHash,
        },
      });
      await cleanupAndFailRoleIntake({
        code: DUPLICATE_IMPORT_ERROR,
        duplicateOfIntakeId:
          existing && existing.status !== "consumed" ? existing.id : undefined,
        intake,
        message:
          existing?.status === "consumed"
            ? "This exact role brief has already created a role in this workspace."
            : "This exact role brief is already being processed in this workspace.",
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

async function processRoleIntakeUrl(
  intake: RoleIntakeRecord,
  dependencies: RoleIntakeServiceDependencies,
): Promise<RoleIntakeProcessResult> {
  if (!intake.submittedUrl) {
    await failUrlRoleIntake(
      intake.id,
      "source_url_missing",
      "The public job URL is no longer available. Start from a manual brief instead.",
    );
    return { kind: "processed", intakeId: intake.id, status: "failed" };
  }

  try {
    const imported = await (dependencies.urlImporter ?? fetchRoleIntakePublicPage)(
      intake.submittedUrl,
    );
    const sourceIdentity = createRoleIntakeUrlIdentity(new URL(imported.canonicalUrl));
    const existing = await prisma.roleIntake.findFirst({
      select: { id: true, status: true },
      where: {
        id: { not: intake.id },
        organizationId: intake.organizationId,
        sourceIdentity,
        status: { in: ["queued", "processing", "ready_for_review", "consumed"] },
      },
    });
    if (existing) {
      await failUrlRoleIntake(
        intake.id,
        DUPLICATE_IMPORT_ERROR,
        existing.status === "consumed"
          ? "This public job URL has already created a role in this workspace."
          : "This public job URL already has an intake in this workspace.",
        existing.status === "consumed" ? undefined : existing.id,
      );
      return { kind: "processed", intakeId: intake.id, status: "failed" };
    }

    await prisma.roleIntake.update({
      data: {
        canonicalUrl: imported.canonicalUrl,
        detectedMimeType: "text/html",
        events: {
          create: [
            { eventType: "role_intake_source_policy_checked", metadata: { outcome: "allowed" } },
            { eventType: "role_intake_extraction_completed", metadata: { source_kind: "url" } },
          ],
        },
        extractedDraft: toJson(imported.draft),
        lastErrorCode: null,
        lastErrorSummary: null,
        parserVersion: imported.extractorVersion,
        processingLeaseExpiresAt: null,
        reviewedDraft: toJson(imported.draft),
        sourceIdentity,
        sourceMetadata: toJson({
          extractor_version: imported.extractorVersion,
          fetched_at: imported.fetchedAt.toISOString(),
          field_sources: imported.fieldSources,
          source_host: imported.sourceHost,
        }),
        status: "ready_for_review",
        warnings: toJson(imported.warnings),
      },
      where: { id: intake.id },
    });
    return { kind: "processed", intakeId: intake.id, status: "ready_for_review" };
  } catch (error) {
    if (isDuplicateRoleIntakeError(error)) {
      await failUrlRoleIntake(
        intake.id,
        DUPLICATE_IMPORT_ERROR,
        "This public job URL already has an intake in this workspace.",
      );
      return { kind: "processed", intakeId: intake.id, status: "failed" };
    }
    if (error instanceof RoleIntakeUrlImportError && error.retryable) {
      if (intake.attemptCount < ROLE_INTAKE_URL_MAX_ATTEMPTS) {
        await prisma.roleIntake.update({
          data: {
            events: {
              create: {
                eventType: "role_intake_fetch_retry_scheduled",
                metadata: { source_kind: "url" },
              },
            },
            lastErrorCode: error.code,
            lastErrorSummary: error.message,
            nextAttemptAt: retryRoleIntakeAt(intake.attemptCount),
            processingLeaseExpiresAt: null,
            status: "queued",
          },
          where: { id: intake.id },
        });
        return { kind: "processed", intakeId: intake.id, status: "queued" };
      }
    }

    await failUrlRoleIntake(
      intake.id,
      error instanceof RoleIntakeUrlImportError ? error.code : "processing_failed",
      error instanceof RoleIntakeUrlImportError
        ? error.message
        : "Prelude could not import this public job page. Start from a manual brief instead.",
    );
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
    const deleted =
      intake.sourceKind === "url"
        ? true
        : storage
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
  duplicateOfIntakeId,
  intake,
  message,
  storage,
  telemetryEvent,
}: {
  code: string;
  duplicateOfIntakeId?: string;
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
      duplicateOfIntakeId: duplicateOfIntakeId ?? null,
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

async function failUrlRoleIntake(
  id: string,
  code: string,
  summary: string,
  duplicateOfIntakeId?: string,
): Promise<void> {
  await prisma.roleIntake.update({
    data: {
      duplicateOfIntakeId: duplicateOfIntakeId ?? null,
      events: {
        create: {
          eventType: "role_intake_url_import_failed",
          metadata: { error_code: code, source_kind: "url" },
        },
      },
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
    duplicateOfIntakeId: intake.duplicateOfIntakeId,
    expiresAt: intake.expiresAt.toISOString(),
    failureMessage: intake.lastErrorSummary,
    id: intake.id,
    originalFileName: intake.originalFileName,
    reviewVersion: intake.reviewVersion,
    reviewedDraft: normalizeImportedRoleDraft(intake.reviewedDraft),
    source: toSourceProvenance(intake),
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

function changedRoleDraftFields(previous: unknown, next: ImportedRoleDraft): string[] {
  const before = normalizeImportedRoleDraft(previous);
  return (["title", "location", "description"] as const).filter(
    (field) => before[field] !== next[field],
  );
}

function toSourceProvenance(intake: RoleIntakeRecord): RoleIntakeSourceProvenance {
  if (intake.sourceKind !== "url") {
    return {
      canonicalUrl: null,
      displayName: intake.originalFileName,
      extractorVersion: intake.parserVersion,
      fetchedAt: null,
      fieldSources: null,
      submittedUrl: null,
    };
  }
  const metadata = asRecord(intake.sourceMetadata);
  const sourceHost = asNonEmptyString(metadata.source_host) ?? intake.originalFileName;
  return {
    canonicalUrl: intake.canonicalUrl,
    displayName: sourceHost,
    extractorVersion: asNonEmptyString(metadata.extractor_version) ?? intake.parserVersion,
    fetchedAt: asIsoDate(metadata.fetched_at),
    fieldSources: asFieldSources(metadata.field_sources),
    submittedUrl: intake.submittedUrl,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function asFieldSources(value: unknown): RoleIntakeSourceProvenance["fieldSources"] {
  type FieldSources = NonNullable<RoleIntakeSourceProvenance["fieldSources"]>;
  const source = asRecord(value);
  const allowed = new Set([
    "job_posting_json_ld",
    "main_content",
    "heading",
    "page_title",
    "unavailable",
  ]);
  const fields = ["title", "location", "description"] as const;
  if (!fields.every((field) => typeof source[field] === "string" && allowed.has(source[field]))) {
    return null;
  }
  return {
    description: source.description as FieldSources["description"],
    location: source.location as FieldSources["location"],
    title: source.title as FieldSources["title"],
  };
}
