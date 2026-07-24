import { describe, expect, it } from "vitest";

import {
  pageBucket,
  roleIntakeExtractionCompletedMetadata,
  roleIntakeReviewSubmittedMetadata,
  roleIntakeSourceSelectedMetadata,
  roleIntakeUploadCompletedMetadata,
  sizeBucket,
  textLengthBucket,
} from "./role-intake-telemetry";

describe("role intake telemetry", () => {
  it("buckets document properties without retaining exact customer data", () => {
    expect(sizeBucket(20_000)).toBe("under_100_kb");
    expect(sizeBucket(500_000)).toBe("100_kb_to_1_mb");
    expect(sizeBucket(5_000_000)).toBe("1_mb_to_10_mb");
    expect(textLengthBucket(0)).toBe("empty");
    expect(textLengthBucket(12_000)).toBe("5k_to_25k");
    expect(pageBucket(1)).toBe("1");
    expect(pageBucket(42)).toBe("21_to_100");
    expect(pageBucket(null)).toBe("not_available");
  });

  it("records only allow-listed structural source metadata", () => {
    expect(
      roleIntakeSourceSelectedMetadata({
        intakeId: "intake_123",
        sourceKind: "file",
      }),
    ).toEqual({
      entry_point: "new_role",
      intake_id: "intake_123",
      source_kind: "file",
    });

    expect(
      roleIntakeUploadCompletedMetadata({
        byteSize: 500_000,
        detectedMimeType: "application/pdf",
        intakeId: "intake_123",
      }),
    ).toEqual({
      detected_mime: "application/pdf",
      intake_id: "intake_123",
      signature_valid: true,
      size_bucket: "100_kb_to_1_mb",
    });
    expect(
      roleIntakeExtractionCompletedMetadata({
        durationMs: 1_200,
        intakeId: "intake_123",
        outcome: "ready",
        pageCount: 3,
        parserVersion: "pdfjs-dist",
        textLength: 12_000,
        warningCodes: ["extraction_truncated"],
      }),
    ).toEqual({
      duration_ms: 1_200,
      intake_id: "intake_123",
      outcome: "ready",
      page_bucket: "2_to_5",
      parser_version: "pdfjs-dist",
      text_length_bucket: "5k_to_25k",
      warning_codes: ["extraction_truncated"],
    });
    expect(
      roleIntakeReviewSubmittedMetadata({
        changedFields: ["title"],
        elapsedMs: 32_000,
        intakeId: "intake_123",
      }),
    ).toEqual({
      changed_field_names: ["title"],
      elapsed_ms: 32_000,
      intake_id: "intake_123",
      manual_fallback_used: false,
    });
  });
});
