import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_OVERRIDE_MIN_JUSTIFICATION,
  complianceOverrideJustificationSchema,
  complianceOverrideRecordSchema,
  complianceOverrideRequestSchema,
} from "./compliance-override";

describe("complianceOverrideJustificationSchema", () => {
  it("accepts a substantive, multi-word justification", () => {
    const result = complianceOverrideJustificationSchema.safeParse(
      "Lifting 25kg is an essential function for this warehouse role.",
    );

    expect(result.success).toBe(true);
  });

  it("rejects a too-short justification (friction floor)", () => {
    expect(complianceOverrideJustificationSchema.safeParse("ok").success).toBe(
      false,
    );
  });

  it("rejects a long-but-thin single-token justification", () => {
    // 24 chars clears the length floor but is a single word -> nominal oversight.
    expect(
      complianceOverrideJustificationSchema.safeParse(
        "aaaaaaaaaaaaaaaaaaaaaaaa",
      ).success,
    ).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    const result = complianceOverrideJustificationSchema.safeParse(
      "   genuine business reason explained clearly here   ",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startsWith(" ")).toBe(false);
      expect(result.data.endsWith(" ")).toBe(false);
    }
  });

  it("exposes the minimum-length floor as a constant", () => {
    expect(COMPLIANCE_OVERRIDE_MIN_JUSTIFICATION).toBeGreaterThanOrEqual(20);
  });
});

describe("complianceOverrideRequestSchema", () => {
  it("requires a justification field", () => {
    expect(complianceOverrideRequestSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a request carrying a substantive justification", () => {
    const result = complianceOverrideRequestSchema.safeParse({
      justification:
        "This availability question is bona-fide for shift scheduling.",
    });

    expect(result.success).toBe(true);
  });
});

describe("complianceOverrideRecordSchema", () => {
  const base = {
    justification:
      "Availability for weekend shifts is a bona-fide scheduling requirement.",
    overriddenByUserId: "user_1",
    overriddenByRole: "owner",
    organizationId: "org_1",
    overriddenAt: "2026-06-22T10:00:00.000Z",
    classifierProvider: "openai_responses",
    classifierModel: "gpt-4.1-mini",
    classifierPromptVersion: "protected-topic-v1",
    classifierSchemaVersion: "protected-topic-schema-v1",
    keywordGatePassed: true as const,
    flags: [
      {
        category: "family_or_pregnancy",
        reason: "asks about weekend availability",
        segment: "Are you available to work weekends?",
        confidence: 0.83,
      },
    ],
  };

  it("accepts a complete audit record", () => {
    expect(complianceOverrideRecordSchema.safeParse(base).success).toBe(true);
  });

  it("requires keywordGatePassed to be literally true (override never bypasses the keyword gate)", () => {
    expect(
      complianceOverrideRecordSchema.safeParse({
        ...base,
        keywordGatePassed: false,
      }).success,
    ).toBe(false);
  });

  it("requires at least one recorded flag", () => {
    expect(
      complianceOverrideRecordSchema.safeParse({ ...base, flags: [] }).success,
    ).toBe(false);
  });

  it("pins the classifier schema version for reproducibility", () => {
    expect(
      complianceOverrideRecordSchema.safeParse({
        ...base,
        classifierSchemaVersion: "",
      }).success,
    ).toBe(false);
  });

  it("records the exact flagged segment so the verdict is auditable against published content", () => {
    const result = complianceOverrideRecordSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flags[0]?.segment).toContain("weekends");
    }
  });

  it("requires the recruiter role at the time of the override", () => {
    const withoutRole: Record<string, unknown> = { ...base };
    delete withoutRole.overriddenByRole;

    expect(complianceOverrideRecordSchema.safeParse(withoutRole).success).toBe(
      false,
    );
  });

  it("preserves an optional per-flag classifier confidence", () => {
    const result = complianceOverrideRecordSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flags[0]?.confidence).toBe(0.83);
    }
  });

  it("accepts a flag without a confidence (deterministic-style verdict)", () => {
    const result = complianceOverrideRecordSchema.safeParse({
      ...base,
      flags: [{ category: "age", reason: "x", segment: "y" }],
    });

    expect(result.success).toBe(true);
  });
});
