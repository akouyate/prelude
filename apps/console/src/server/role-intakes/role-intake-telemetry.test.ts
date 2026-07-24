import { describe, expect, it } from "vitest";

import {
  bucketRoleIntakeByteSize,
  bucketRoleIntakeDuration,
  bucketRoleIntakePageCount,
  bucketRoleIntakeTextLength,
  roleIntakeTelemetry,
} from "./role-intake-telemetry";

describe("role intake telemetry", () => {
  it("builds the seven issue #121 events without duplicating the intake relation", () => {
    const events = [
      roleIntakeTelemetry.sourceSelected({
        sourceKind: "file",
        entryPoint: "role_builder",
      }),
      roleIntakeTelemetry.uploadCompleted({
        detectedMime: "application/pdf",
        byteSize: 512 * 1024,
        signatureValid: true,
      }),
      roleIntakeTelemetry.scanCompleted({ outcome: "clean", durationMs: 24 }),
      roleIntakeTelemetry.extractionCompleted({
        outcome: "ready_for_review",
        parserVersion: "pdfjs-v4",
        pageCount: 2,
        textLength: 1_500,
        warningCodes: ["extraction_truncated"],
        durationMs: 40,
      }),
      roleIntakeTelemetry.reviewSubmitted({
        changedFieldNames: ["title", "description"],
        manualFallbackUsed: false,
        elapsedMs: 50,
      }),
      roleIntakeTelemetry.converted({ outcome: "converted", elapsedMs: 60 }),
      roleIntakeTelemetry.objectDeleted({ reason: "extracted" }),
    ];

    expect(events.map((event) => event.eventType)).toEqual([
      "role_intake_source_selected",
      "role_intake_upload_completed",
      "role_intake_scan_completed",
      "role_intake_extraction_completed",
      "role_intake_review_submitted",
      "role_intake_converted",
      "role_intake_object_deleted",
    ]);
    expect(events.every((event) => !("roleIntakeId" in event.metadata))).toBe(
      true,
    );
  });

  it("keeps only structural allowlisted metadata and never serializes sensitive values", () => {
    const event = roleIntakeTelemetry.extractionCompleted({
      outcome: "ready_for_review",
      parserVersion: "Private parser message from candidate@example.com",
      pageCount: null,
      textLength: 1_500,
      warningCodes: [
        "docx_parser_notice",
        "docx_parser_notice",
        "contains_candidate_email@example.com",
        "parser message with source text",
      ],
      durationMs: 42,
      originalFileName: "candidate-brief.pdf",
      documentText: "Private job brief text",
      url: "https://private.example/brief",
      sha256: "a".repeat(64),
      candidateEmail: "candidate@example.com",
      parserMessage: "Private parser message",
      unknown: "must not persist",
    } as never);

    expect(event.metadata).toEqual({
      outcome: "ready_for_review",
      parser_version: "unknown",
      page_bucket: "unknown",
      text_length_bucket: "1k-5k",
      warning_codes: ["docx_parser_notice"],
      duration_ms: 42,
    });
    expect(JSON.stringify(event.metadata)).not.toMatch(
      /candidate|private|https|sha256|message/i,
    );
  });

  it("buckets structural metrics without retaining precise document measurements", () => {
    expect(bucketRoleIntakeByteSize(0)).toBe("0-100kb");
    expect(bucketRoleIntakeByteSize(1024 * 1024)).toBe("100kb-1mb");
    expect(bucketRoleIntakeByteSize(10 * 1024 * 1024 + 1)).toBe("over-10mb");
    expect(bucketRoleIntakePageCount(0)).toBe("0");
    expect(bucketRoleIntakePageCount(null)).toBe("unknown");
    expect(bucketRoleIntakePageCount(1)).toBe("1");
    expect(bucketRoleIntakePageCount(2)).toBe("2-5");
    expect(bucketRoleIntakePageCount(101)).toBe("101+");
    expect(bucketRoleIntakeTextLength(0)).toBe("0");
    expect(bucketRoleIntakeTextLength(1_000)).toBe("1-1k");
    expect(bucketRoleIntakeTextLength(1_001)).toBe("1k-5k");
    expect(bucketRoleIntakeDuration(-1)).toBe(0);
    expect(bucketRoleIntakeDuration(Number.POSITIVE_INFINITY)).toBe(86_400_000);
  });

  it("retains bounded real parser versions and retry-safe scan outcomes", () => {
    expect(
      roleIntakeTelemetry.extractionCompleted({
        outcome: "ready_for_review",
        parserVersion: "pdfjs-dist",
        pageCount: 1,
        textLength: 12,
        warningCodes: [],
        durationMs: 1,
      }).metadata.parser_version,
    ).toBe("pdfjs-dist");
    expect(
      roleIntakeTelemetry.extractionCompleted({
        outcome: "ready_for_review",
        parserVersion: "static-html-v1",
        pageCount: null,
        textLength: 12,
        warningCodes: [],
        durationMs: 1,
      }).metadata.page_bucket,
    ).toBe("unknown");
    expect(
      roleIntakeTelemetry.scanCompleted({
        outcome: "unavailable",
        durationMs: 1,
      }),
    ).toEqual({
      eventType: "role_intake_scan_completed",
      metadata: { outcome: "unavailable", duration_ms: 1 },
    });
  });

  it("deduplicates and bounds warning codes", () => {
    const event = roleIntakeTelemetry.extractionCompleted({
      outcome: "manual_fallback",
      parserVersion: "mammoth-v1",
      pageCount: 1,
      textLength: 0,
      warningCodes: Array.from(
        { length: 12 },
        (_, index) => `warning_${index}`,
      ).concat("warning_0"),
      durationMs: 1,
    });

    expect(event.metadata.warning_codes).toHaveLength(10);
    expect(event.metadata.warning_codes).toEqual(
      Array.from({ length: 10 }, (_, index) => `warning_${index}`),
    );
  });
});
