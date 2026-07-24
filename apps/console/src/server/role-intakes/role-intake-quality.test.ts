import { describe, expect, it } from "vitest";

import {
  calculatePilotReport,
  isAcceptedTitle,
  median,
  nearestRankPercentile,
  scoreFixture,
  type PilotAssessment,
} from "./role-intake-quality";
import {
  ROLE_INTAKE_QUALITY_FIXTURES,
  createInMemoryQualityCorpus,
} from "./fixtures/manifest";

describe("role intake quality corpus", () => {
  it("provides a deterministic non-customer EN/FR fixture taxonomy", () => {
    const corpus = createInMemoryQualityCorpus();

    expect(corpus).toHaveLength(11);
    expect(new Set(corpus.map((fixture) => fixture.locale))).toEqual(
      new Set(["en", "fr"]),
    );
    expect(new Set(corpus.map((fixture) => fixture.format))).toEqual(
      new Set(["pdf", "docx"]),
    );
    expect(corpus.map((fixture) => fixture.expectedOutcome)).toEqual(
      expect.arrayContaining(["extract", "manual_fallback", "reject"]),
    );
    expect(
      corpus.find((fixture) => fixture.id === "en-clean-pdf")
        ?.acceptedTitleAliases,
    ).toContain("product manager");
    expect(
      corpus.find((fixture) => fixture.id === "fr-unicode-docx")
        ?.requiredDescriptionFactGroups,
    ).toEqual(expect.arrayContaining(["responsibilities", "stakeholders"]));
    expect(
      corpus.some((fixture) => fixture.variant === "external_relationship"),
    ).toBe(true);
    expect(
      corpus.some((fixture) => fixture.variant === "scanned_no_text"),
    ).toBe(true);
    expect(ROLE_INTAKE_QUALITY_FIXTURES).toEqual(corpus);
  });
});

describe("role intake quality scoring", () => {
  it("accepts normalized title aliases without comparing raw document text", () => {
    expect(isAcceptedTitle("  PRODUCT-MANAGER ", ["Product Manager"])).toBe(
      true,
    );
    expect(
      isAcceptedTitle("Responsable achats", ["Responsable des achats"]),
    ).toBe(false);

    const fixture = ROLE_INTAKE_QUALITY_FIXTURES.find(
      (item) => item.id === "en-clean-pdf",
    );
    if (!fixture) throw new Error("fixture missing");

    expect(
      scoreFixture(fixture, {
        extractedTitle: "PRODUCT-MANAGER",
        extractedFactGroups: ["responsibilities", "stakeholders", "impact"],
        usedManualFallback: false,
        fabricatedFieldCount: 0,
      }),
    ).toMatchObject({
      titleAccepted: true,
      descriptionCoverage: 1,
      descriptionMateriallyComplete: true,
      fallbackCorrect: true,
    });
  });

  it("scores missing location and no-text fallback as structural outcomes", () => {
    const missingLocation = ROLE_INTAKE_QUALITY_FIXTURES.find(
      (fixture) => fixture.id === "en-missing-location-docx",
    );
    const scanned = ROLE_INTAKE_QUALITY_FIXTURES.find(
      (fixture) => fixture.id === "en-scanned-pdf",
    );
    if (!missingLocation || !scanned) throw new Error("fixture missing");

    expect(
      scoreFixture(missingLocation, {
        extractedTitle: "Operations Manager",
        extractedFactGroups: ["responsibilities", "stakeholders", "impact"],
        usedManualFallback: false,
        fabricatedFieldCount: 0,
      }),
    ).toMatchObject({
      titleAccepted: true,
      descriptionMateriallyComplete: true,
      locationExpected: false,
    });

    expect(
      scoreFixture(scanned, {
        extractedFactGroups: [],
        usedManualFallback: true,
        fabricatedFieldCount: 0,
      }),
    ).toMatchObject({
      titleAccepted: null,
      descriptionMateriallyComplete: null,
      fallbackCorrect: true,
    });
  });

  it("rejects fabricated fallback output and reports partial fact coverage", () => {
    const fixture = ROLE_INTAKE_QUALITY_FIXTURES.find(
      (item) => item.id === "fr-unicode-docx",
    );
    if (!fixture) throw new Error("fixture missing");

    expect(
      scoreFixture(fixture, {
        extractedTitle: "Responsable expérience client",
        extractedFactGroups: ["responsibilities"],
        usedManualFallback: true,
        fabricatedFieldCount: 1,
      }),
    ).toMatchObject({
      titleAccepted: true,
      descriptionCoverage: 1 / 3,
      descriptionMateriallyComplete: false,
      fallbackCorrect: false,
    });
  });
});

describe("role intake pilot report", () => {
  it("uses nearest-rank p95 and median", () => {
    expect(nearestRankPercentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
    expect(nearestRankPercentile([50, 10, 30, 20, 40], 0.5)).toBe(30);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
  });

  it("keeps every pilot gate insufficient before 50 assessments", () => {
    const report = calculatePilotReport([createAssessment(1)]);

    expect(report.sampleSize).toBe(1);
    expect(
      Object.values(report.gates).every(
        (gate) => gate.status === "insufficient_data",
      ),
    ).toBe(true);
  });

  it("passes a complete 50-assessment pilot with baseline evidence", () => {
    const report = calculatePilotReport(
      Array.from({ length: 50 }, (_, index) => createAssessment(index)),
    );

    expect(report.sampleSize).toBe(50);
    expect(report.terminalLatencyP95Ms).toBe(30_000);
    expect(report.medianAutomaticBuilderMs).toBe(20_000);
    expect(report.medianManualBaselineMs).toBe(60_000);
    expect(report.conversionWithin24hRate).toBe(1);
    expect(report.gates.clean_terminal_p95.status).toBe("pass");
    expect(report.gates.title_acceptance.status).toBe("pass");
    expect(report.gates.description_completeness.status).toBe("pass");
    expect(report.gates.fallback_precision.status).toBe("pass");
    expect(report.gates.conversion_within_24h.status).toBe("pass");
    expect(report.gates.deletion_sla.status).toBe("pass");
    expect(report.gates.duplicate_jobs_and_drafts.status).toBe("pass");
    expect(report.gates.manual_baseline_improvement.status).toBe("pass");
  });

  it("does not pass human quality gates with incomplete labels", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index),
    );
    assessments[5] = {
      ...assessments[5]!,
      titleAcceptable: undefined,
      descriptionMateriallyComplete: undefined,
    };

    const report = calculatePilotReport(assessments);

    expect(report.gates.title_acceptance.status).toBe("insufficient_data");
    expect(report.gates.description_completeness.status).toBe(
      "insufficient_data",
    );
  });

  it("does not infer fallback correctness from the observed parser outcome", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index),
    );
    assessments[0] = {
      ...assessments[0]!,
      expectedManualFallback: undefined,
      fabricatedFieldCount: undefined,
    };

    expect(
      calculatePilotReport(assessments).gates.fallback_precision.status,
    ).toBe("insufficient_data");
  });

  it("compares automatic and manual durations only for matched roles", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index),
    );
    assessments[5] = {
      ...assessments[5]!,
      automaticBuilderMs: 1,
      manualBaselineMs: undefined,
    };
    assessments[6] = {
      ...assessments[6]!,
      automaticBuilderMs: undefined,
      manualBaselineMs: 1_000_000,
    };

    const report = calculatePilotReport(assessments);

    expect(report.medianAutomaticBuilderMs).toBe(20_000);
    expect(report.medianManualBaselineMs).toBe(60_000);
    expect(report.gates.manual_baseline_improvement.status).toBe(
      "insufficient_data",
    );
  });

  it("counts missing deletion evidence as an SLA breach", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index),
    );
    assessments[0] = {
      ...assessments[0]!,
      deletedAt: undefined,
      deletionVerified: false,
    };
    assessments[1] = {
      ...assessments[1]!,
      deletionRequiredAt: undefined,
      deletionVerified: false,
    };

    const report = calculatePilotReport(assessments);

    expect(report.deletionSlaBreaches).toBe(2);
    expect(report.gates.deletion_sla.status).toBe("fail");
  });

  it("fails the fallback gate when one expected fallback is missed", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index),
    );
    assessments[0] = {
      ...assessments[0]!,
      manualFallbackUsed: false,
    };

    expect(
      calculatePilotReport(assessments).gates.fallback_precision.status,
    ).toBe("fail");
  });

  it("fails the fallback gate when a readable document is routed manually", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index),
    );
    assessments[5] = {
      ...assessments[5]!,
      manualFallbackUsed: true,
    };

    expect(
      calculatePilotReport(assessments).gates.fallback_precision.status,
    ).toBe("fail");
  });

  it("fails measurable quality, latency, conversion, deletion, and duplication regressions", () => {
    const assessments = Array.from({ length: 50 }, (_, index) =>
      createAssessment(index, {
        titleAcceptable: index < 40,
        descriptionMateriallyComplete: index < 35,
        terminalLatencyMs: index >= 47 ? 61_000 : 30_000,
        convertedAt: index < 20 ? "2026-01-01T01:00:00.000Z" : undefined,
        deletedAt:
          index === 0 ? "2026-01-03T00:01:00.000Z" : "2026-01-02T00:01:00.000Z",
        jobCount: index === 0 ? 2 : 1,
        draftCount: index === 1 ? 2 : 1,
      }),
    );

    const report = calculatePilotReport(assessments);

    expect(report.gates.clean_terminal_p95.status).toBe("fail");
    expect(report.gates.title_acceptance.status).toBe("fail");
    expect(report.gates.description_completeness.status).toBe("fail");
    expect(report.gates.conversion_within_24h.status).toBe("fail");
    expect(report.gates.deletion_sla.status).toBe("fail");
    expect(report.gates.duplicate_jobs_and_drafts.status).toBe("fail");
  });
});

function createAssessment(
  index: number,
  overrides: Partial<PilotAssessment> = {},
): PilotAssessment {
  return {
    assessmentId: `fixture-assessment-${index}`,
    assessedAt: "2026-01-01T00:00:00.000Z",
    cleanEligible: index >= 5,
    titleAcceptable: true,
    descriptionMateriallyComplete: true,
    expectedManualFallback: index < 5,
    manualFallbackUsed: index < 5,
    fabricatedFieldCount: 0,
    terminalLatencyMs: 30_000,
    uploadCompletedAt: "2026-01-01T00:00:00.000Z",
    terminalAt: "2026-01-01T00:00:30.000Z",
    convertedAt: "2026-01-01T01:00:00.000Z",
    deletionRequiredAt: "2026-01-02T00:00:00.000Z",
    deletedAt: "2026-01-02T00:01:00.000Z",
    deletionVerified: true,
    jobCount: 1,
    draftCount: 1,
    automaticBuilderMs: 20_000,
    manualBaselineMs: 60_000,
    ...overrides,
  };
}
