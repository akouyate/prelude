const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_WARNING_CODES = 10;

const sourceKinds = new Set(["file", "manual", "url"]);
const entryPoints = new Set(["role_builder", "role_detail", "unknown"]);
const scanOutcomes = new Set([
  "clean",
  "infected",
  "queued",
  "unavailable",
  "failed",
]);
const extractionOutcomes = new Set([
  "ready_for_review",
  "manual_fallback",
  "failed",
]);
const conversionOutcomes = new Set(["converted", "failed"]);
const deletionReasons = new Set([
  "extracted",
  "expired",
  "failed",
  "cancelled",
]);

type SourceKind = "file" | "manual" | "url";
type EntryPoint = "role_builder" | "role_detail" | "unknown";
type ScanOutcome = "clean" | "infected" | "queued" | "unavailable" | "failed";
type ExtractionOutcome = "ready_for_review" | "manual_fallback" | "failed";
type ConversionOutcome = "converted" | "failed";
type DeletionReason = "extracted" | "expired" | "failed" | "cancelled";
type ParserVersion = string;

export type RoleIntakeTelemetryEvent =
  | {
      eventType: "role_intake_source_selected";
      metadata: { source_kind: SourceKind; entry_point: EntryPoint };
    }
  | {
      eventType: "role_intake_upload_completed";
      metadata: {
        detected_mime:
          | "application/pdf"
          | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          | "unknown";
        size_bucket: RoleIntakeByteSizeBucket;
        signature_valid: boolean;
      };
    }
  | {
      eventType: "role_intake_scan_completed";
      metadata: { outcome: ScanOutcome; duration_ms: number };
    }
  | {
      eventType: "role_intake_extraction_completed";
      metadata: {
        outcome: ExtractionOutcome;
        parser_version: ParserVersion;
        page_bucket: RoleIntakePageCountBucket;
        text_length_bucket: RoleIntakeTextLengthBucket;
        warning_codes: string[];
        duration_ms: number;
      };
    }
  | {
      eventType: "role_intake_review_submitted";
      metadata: {
        changed_field_names: Array<"title" | "location" | "description">;
        manual_fallback_used: boolean;
        elapsed_ms: number;
      };
    }
  | {
      eventType: "role_intake_converted";
      metadata: { outcome: ConversionOutcome; elapsed_ms: number };
    }
  | {
      eventType: "role_intake_object_deleted";
      metadata: { reason: DeletionReason };
    };

export type RoleIntakeByteSizeBucket =
  | "0-100kb"
  | "100kb-1mb"
  | "1mb-5mb"
  | "5mb-10mb"
  | "over-10mb";

export type RoleIntakePageCountBucket =
  | "unknown"
  | "0"
  | "1"
  | "2-5"
  | "6-20"
  | "21-100"
  | "101+";
export type RoleIntakeTextLengthBucket =
  | "0"
  | "1-1k"
  | "1k-5k"
  | "5k-20k"
  | "20k+";

type SourceSelectedInput = {
  sourceKind: SourceKind;
  entryPoint: EntryPoint;
};
type UploadCompletedInput = {
  detectedMime: string;
  byteSize: number;
  signatureValid: boolean;
};
type ScanCompletedInput = { outcome: ScanOutcome; durationMs: number };
type ExtractionCompletedInput = {
  outcome: ExtractionOutcome;
  parserVersion: ParserVersion;
  pageCount: number | null;
  textLength: number;
  warningCodes: readonly unknown[];
  durationMs: number;
};
type ReviewSubmittedInput = {
  changedFieldNames: readonly unknown[];
  manualFallbackUsed: boolean;
  elapsedMs: number;
};
type ConvertedInput = { outcome: ConversionOutcome; elapsedMs: number };
type ObjectDeletedInput = { reason: DeletionReason };

const changedFieldNames = new Set(["title", "location", "description"]);

export function bucketRoleIntakeByteSize(
  byteSize: number,
): RoleIntakeByteSizeBucket {
  const normalized = nonNegativeInteger(byteSize);
  if (normalized < 100 * 1024) return "0-100kb";
  if (normalized <= 1024 * 1024) return "100kb-1mb";
  if (normalized <= 5 * 1024 * 1024) return "1mb-5mb";
  if (normalized <= 10 * 1024 * 1024) return "5mb-10mb";
  return "over-10mb";
}

export function bucketRoleIntakePageCount(
  pageCount: number | null,
): RoleIntakePageCountBucket {
  if (pageCount === null) return "unknown";
  const normalized = nonNegativeInteger(pageCount);
  if (normalized === 0) return "0";
  if (normalized === 1) return "1";
  if (normalized <= 5) return "2-5";
  if (normalized <= 20) return "6-20";
  if (normalized <= 100) return "21-100";
  return "101+";
}

export function bucketRoleIntakeTextLength(
  textLength: number,
): RoleIntakeTextLengthBucket {
  const normalized = nonNegativeInteger(textLength);
  if (normalized === 0) return "0";
  if (normalized <= 1_000) return "1-1k";
  if (normalized <= 5_000) return "1k-5k";
  if (normalized <= 20_000) return "5k-20k";
  return "20k+";
}

export function bucketRoleIntakeDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return durationMs > 0 ? MAX_DURATION_MS : 0;
  }
  return Math.min(Math.max(Math.trunc(durationMs), 0), MAX_DURATION_MS);
}

export const roleIntakeTelemetry = {
  sourceSelected(input: SourceSelectedInput): RoleIntakeTelemetryEvent {
    return {
      eventType: "role_intake_source_selected",
      metadata: {
        source_kind: normalizeEnum(input.sourceKind, sourceKinds, "manual"),
        entry_point: normalizeEnum(input.entryPoint, entryPoints, "unknown"),
      },
    };
  },

  uploadCompleted(input: UploadCompletedInput): RoleIntakeTelemetryEvent {
    return {
      eventType: "role_intake_upload_completed",
      metadata: {
        detected_mime: normalizeMime(input.detectedMime),
        size_bucket: bucketRoleIntakeByteSize(input.byteSize),
        signature_valid: input.signatureValid === true,
      },
    };
  },

  scanCompleted(input: ScanCompletedInput): RoleIntakeTelemetryEvent {
    return {
      eventType: "role_intake_scan_completed",
      metadata: {
        outcome: normalizeEnum(input.outcome, scanOutcomes, "failed"),
        duration_ms: bucketRoleIntakeDuration(input.durationMs),
      },
    };
  },

  extractionCompleted(
    input: ExtractionCompletedInput,
  ): Extract<
    RoleIntakeTelemetryEvent,
    { eventType: "role_intake_extraction_completed" }
  > {
    return {
      eventType: "role_intake_extraction_completed",
      metadata: {
        outcome: normalizeEnum(input.outcome, extractionOutcomes, "failed"),
        parser_version: normalizeParserVersion(input.parserVersion),
        page_bucket: bucketRoleIntakePageCount(input.pageCount),
        text_length_bucket: bucketRoleIntakeTextLength(input.textLength),
        warning_codes: normalizeWarningCodes(input.warningCodes),
        duration_ms: bucketRoleIntakeDuration(input.durationMs),
      },
    };
  },

  reviewSubmitted(input: ReviewSubmittedInput): RoleIntakeTelemetryEvent {
    return {
      eventType: "role_intake_review_submitted",
      metadata: {
        changed_field_names: normalizeChangedFieldNames(
          input.changedFieldNames,
        ),
        manual_fallback_used: input.manualFallbackUsed === true,
        elapsed_ms: bucketRoleIntakeDuration(input.elapsedMs),
      },
    };
  },

  converted(input: ConvertedInput): RoleIntakeTelemetryEvent {
    return {
      eventType: "role_intake_converted",
      metadata: {
        outcome: normalizeEnum(input.outcome, conversionOutcomes, "failed"),
        elapsed_ms: bucketRoleIntakeDuration(input.elapsedMs),
      },
    };
  },

  objectDeleted(input: ObjectDeletedInput): RoleIntakeTelemetryEvent {
    return {
      eventType: "role_intake_object_deleted",
      metadata: {
        reason: normalizeEnum(input.reason, deletionReasons, "failed"),
      },
    };
  },
};

function normalizeMime(
  value: string,
):
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "unknown" {
  if (value === "application/pdf") return value;
  if (
    value ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeWarningCodes(input: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const code = value.trim();
    if (!/^[a-z0-9_]{1,80}$/.test(code) || seen.size >= MAX_WARNING_CODES) {
      continue;
    }
    seen.add(code);
  }
  return [...seen];
}

function normalizeChangedFieldNames(
  input: readonly unknown[],
): Array<"title" | "location" | "description"> {
  const fields: Array<"title" | "location" | "description"> = [];
  for (const value of input) {
    if (
      typeof value !== "string" ||
      !changedFieldNames.has(value) ||
      fields.includes(value as never)
    ) {
      continue;
    }
    fields.push(value as "title" | "location" | "description");
  }
  return fields;
}

function normalizeParserVersion(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)
    ? normalized
    : "unknown";
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: T,
): T {
  return typeof value === "string" && allowed.has(value)
    ? (value as T)
    : fallback;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? Number.MAX_SAFE_INTEGER : 0;
  return Math.max(0, Math.trunc(value));
}
