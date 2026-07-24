import type { RoleIntakeSourceKind } from "@prelude/contracts";

export type RoleIntakeEventMetadata = Record<
  string,
  boolean | number | string | string[]
>;

export function sizeBucket(bytes: number | null): string {
  if (bytes === null || bytes < 0) {
    return "not_available";
  }
  if (bytes < 100_000) {
    return "under_100_kb";
  }
  if (bytes < 1_000_000) {
    return "100_kb_to_1_mb";
  }
  return "1_mb_to_10_mb";
}

export function textLengthBucket(characters: number): string {
  if (characters <= 0) {
    return "empty";
  }
  if (characters < 5_000) {
    return "under_5k";
  }
  if (characters < 25_000) {
    return "5k_to_25k";
  }
  if (characters < 100_000) {
    return "25k_to_100k";
  }
  return "100k_plus";
}

export function pageBucket(pages: number | null): string {
  if (pages === null || pages <= 0) {
    return "not_available";
  }
  if (pages === 1) {
    return "1";
  }
  if (pages <= 5) {
    return "2_to_5";
  }
  if (pages <= 20) {
    return "6_to_20";
  }
  return "21_to_100";
}

export function roleIntakeSourceSelectedMetadata(input: {
  intakeId: string;
  sourceKind: RoleIntakeSourceKind;
}): RoleIntakeEventMetadata {
  return {
    entry_point: "new_role",
    intake_id: input.intakeId,
    source_kind: input.sourceKind,
  };
}

export function roleIntakeUploadCompletedMetadata(input: {
  byteSize: number | null;
  detectedMimeType: string;
  intakeId: string;
}): RoleIntakeEventMetadata {
  return {
    detected_mime: input.detectedMimeType,
    intake_id: input.intakeId,
    signature_valid: true,
    size_bucket: sizeBucket(input.byteSize),
  };
}

export function roleIntakeExtractionCompletedMetadata(input: {
  durationMs: number;
  intakeId: string;
  outcome: "failed" | "ready";
  pageCount: number | null;
  parserVersion: string;
  textLength: number;
  warningCodes: string[];
}): RoleIntakeEventMetadata {
  return {
    duration_ms: input.durationMs,
    intake_id: input.intakeId,
    outcome: input.outcome,
    page_bucket: pageBucket(input.pageCount),
    parser_version: input.parserVersion,
    text_length_bucket: textLengthBucket(input.textLength),
    warning_codes: input.warningCodes,
  };
}

export function roleIntakeReviewSubmittedMetadata(input: {
  changedFields: string[];
  elapsedMs: number;
  intakeId: string;
}): RoleIntakeEventMetadata {
  return {
    changed_field_names: input.changedFields,
    elapsed_ms: input.elapsedMs,
    intake_id: input.intakeId,
    manual_fallback_used: false,
  };
}

export function elapsedMilliseconds(startedAt: Date, endedAt = new Date()): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}
