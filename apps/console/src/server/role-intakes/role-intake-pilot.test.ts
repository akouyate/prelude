import { describe, expect, it } from "vitest";

import {
  buildPilotAssessment,
  parseRoleIntakeManualAssessment,
} from "./role-intake-pilot";

describe("role intake pilot event projection", () => {
  it("projects structural lifecycle events without source content", () => {
    const assessment = buildPilotAssessment(
      {
        cleanedUpAt: new Date("2026-07-24T10:01:00.000Z"),
        cleanupRequestedAt: new Date("2026-07-24T10:00:30.000Z"),
        createdAt: new Date("2026-07-24T10:00:00.000Z"),
        draftCount: 1,
        events: [
          {
            createdAt: new Date("2026-07-24T10:00:02.000Z"),
            eventType: "role_intake_upload_completed",
            metadata: {
              detected_mime: "application/pdf",
              signature_valid: true,
              size_bucket: "0-100kb",
            },
          },
          {
            createdAt: new Date("2026-07-24T10:00:22.000Z"),
            eventType: "role_intake_extraction_completed",
            metadata: { outcome: "ready_for_review" },
          },
          {
            createdAt: new Date("2026-07-24T10:00:40.000Z"),
            eventType: "role_intake_converted",
            metadata: { outcome: "converted" },
          },
          {
            createdAt: new Date("2026-07-24T10:01:00.000Z"),
            eventType: "role_intake_object_deleted",
            metadata: { reason: "extracted" },
          },
        ],
        id: "intake_123",
        jobCount: 1,
        status: "consumed",
        updatedAt: new Date("2026-07-24T10:00:40.000Z"),
      },
      {
        assessmentId: "intake_123",
        cleanEligible: true,
        descriptionMateriallyComplete: true,
        expectedManualFallback: false,
        fabricatedFieldCount: 0,
        manualBaselineMs: 120_000,
        titleAcceptable: true,
      },
    );

    expect(assessment).toMatchObject({
      assessmentId: "intake_123",
      automaticBuilderMs: 38_000,
      cleanEligible: true,
      deletionRequiredAt: new Date("2026-07-24T10:00:02.000Z"),
      deletedAt: new Date("2026-07-24T10:01:00.000Z"),
      deletionVerified: true,
      descriptionMateriallyComplete: true,
      jobCount: 1,
      draftCount: 1,
      manualBaselineMs: 120_000,
      terminalLatencyMs: 20_000,
      titleAcceptable: true,
    });
    expect(JSON.stringify(assessment)).not.toMatch(
      /filename|description text|https|sha256|email/i,
    );
  });

  it("recognizes a no-text fallback without inventing independent quality labels", () => {
    const assessment = buildPilotAssessment({
      cleanedUpAt: new Date("2026-07-24T10:00:20.000Z"),
      cleanupRequestedAt: new Date("2026-07-24T10:00:19.000Z"),
      createdAt: new Date("2026-07-24T10:00:00.000Z"),
      draftCount: 0,
      events: [
        {
          createdAt: new Date("2026-07-24T10:00:01.000Z"),
          eventType: "role_intake_upload_completed",
          metadata: {},
        },
        {
          createdAt: new Date("2026-07-24T10:00:19.000Z"),
          eventType: "role_intake_extraction_completed",
          metadata: { outcome: "manual_fallback" },
        },
      ],
      id: "intake_no_text",
      jobCount: 0,
      status: "failed",
      updatedAt: new Date("2026-07-24T10:00:20.000Z"),
    });

    expect(assessment).toMatchObject({
      assessmentId: "intake_no_text",
      cleanEligible: false,
      manualFallbackUsed: true,
      terminalLatencyMs: 18_000,
    });
    expect(assessment.expectedManualFallback).toBeUndefined();
    expect(assessment.fabricatedFieldCount).toBeUndefined();
    expect(assessment.titleAcceptable).toBeUndefined();
    expect(assessment.descriptionMateriallyComplete).toBeUndefined();
  });

  it("does not infer clean eligibility from a successful extraction", () => {
    const assessment = buildPilotAssessment({
      cleanedUpAt: new Date("2026-07-24T10:00:20.000Z"),
      cleanupRequestedAt: null,
      createdAt: new Date("2026-07-24T10:00:00.000Z"),
      draftCount: 0,
      events: [
        {
          createdAt: new Date("2026-07-24T10:00:01.000Z"),
          eventType: "role_intake_upload_completed",
          metadata: {},
        },
        {
          createdAt: new Date("2026-07-24T10:00:19.000Z"),
          eventType: "role_intake_extraction_completed",
          metadata: { outcome: "ready_for_review" },
        },
      ],
      id: "intake_unlabelled",
      jobCount: 0,
      status: "ready_for_review",
      updatedAt: new Date("2026-07-24T10:00:20.000Z"),
    });

    expect(assessment.cleanEligible).toBe(false);
  });

  it("rejects free-form or unknown manual assessment fields", () => {
    expect(() =>
      parseRoleIntakeManualAssessment({
        assessmentId: "intake_123",
        cleanEligible: true,
        descriptionMateriallyComplete: true,
        expectedManualFallback: false,
        fabricatedFieldCount: 0,
        freeFormNote: "must never enter analytics",
        titleAcceptable: true,
      }),
    ).toThrow("unsupported fields");
  });
});
