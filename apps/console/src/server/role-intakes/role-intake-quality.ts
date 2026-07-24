// Pilot methodology and primary references: docs/sources/role-intake-quality.md.
export const PILOT_ASSESSMENT_MINIMUM = 50;
export const TERMINAL_LATENCY_P95_LIMIT_MS = 60_000;
export const DELETION_SLA_LIMIT_MS = 24 * 60 * 60 * 1_000;
export const CONVERSION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type QualityFormat = "pdf" | "docx";
export type QualityLocale = "en" | "fr";
export type QualityFixtureVariant =
  | "clean"
  | "sparse"
  | "multi_page"
  | "missing_location"
  | "unicode_accents"
  | "scanned_no_text"
  | "empty"
  | "corrupt"
  | "external_relationship";
export type QualityFixtureOutcome = "extract" | "manual_fallback" | "reject";

export type RoleIntakeQualityFixture = {
  id: string;
  format: QualityFormat;
  locale: QualityLocale;
  variant: QualityFixtureVariant;
  expectedOutcome: QualityFixtureOutcome;
  expectedTitle?: string;
  acceptedTitleAliases: readonly string[];
  expectedLocation?: string;
  requiredDescriptionFactGroups: readonly string[];
  expectedWarningCodes: readonly string[];
  expectedParserFallback: boolean;
};

export type FixtureObservation = {
  extractedTitle?: string;
  extractedLocation?: string;
  extractedFactGroups: readonly string[];
  usedManualFallback: boolean;
  fabricatedFieldCount: number;
};

export type FixtureScore = {
  titleAccepted: boolean | null;
  locationExpected: boolean;
  locationCorrect: boolean | null;
  descriptionCoverage: number | null;
  descriptionMateriallyComplete: boolean | null;
  fallbackCorrect: boolean;
};

export type PilotAssessment = {
  /** Structural identifier only; never a filename, URL, hash, or document value. */
  assessmentId: string;
  assessedAt: string | Date;
  cleanEligible: boolean;
  titleAcceptable?: boolean;
  descriptionMateriallyComplete?: boolean;
  expectedManualFallback?: boolean;
  manualFallbackUsed: boolean;
  fabricatedFieldCount?: number;
  terminalLatencyMs?: number;
  uploadCompletedAt?: string | Date;
  terminalAt?: string | Date;
  convertedAt?: string | Date;
  deletionRequiredAt?: string | Date;
  deletedAt?: string | Date;
  deletionVerified: boolean;
  jobCount: number;
  draftCount: number;
  automaticBuilderMs?: number;
  manualBaselineMs?: number;
};

export type QualityGateStatus = "pass" | "fail" | "insufficient_data";

export type QualityGate = {
  status: QualityGateStatus;
  value: number | null;
  threshold: number | null;
  numerator: number | null;
  denominator: number | null;
  reason: string;
};

export type PilotGateName =
  | "clean_terminal_p95"
  | "fallback_precision"
  | "title_acceptance"
  | "description_completeness"
  | "conversion_within_24h"
  | "deletion_sla"
  | "duplicate_jobs_and_drafts"
  | "manual_baseline_improvement";

export type PilotReport = {
  sampleSize: number;
  terminalLatencyP95Ms: number | null;
  medianAutomaticBuilderMs: number | null;
  medianManualBaselineMs: number | null;
  conversionWithin24hRate: number | null;
  fallbackPrecision: number | null;
  deletionSlaBreaches: number | null;
  duplicateJobCount: number;
  duplicateDraftCount: number;
  gates: Record<PilotGateName, QualityGate>;
};

export function normalizeQualityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isAcceptedTitle(
  actualTitle: string | undefined,
  aliases: readonly string[],
): boolean {
  if (!actualTitle) return false;
  const normalized = normalizeQualityText(actualTitle);
  return aliases.some((alias) => normalizeQualityText(alias) === normalized);
}

export function scoreFixture(
  fixture: RoleIntakeQualityFixture,
  observation: FixtureObservation,
): FixtureScore {
  const titleAccepted = fixture.expectedTitle
    ? isAcceptedTitle(observation.extractedTitle, fixture.acceptedTitleAliases)
    : null;
  const locationExpected = fixture.expectedLocation !== undefined;
  const locationCorrect = locationExpected
    ? normalizeQualityText(observation.extractedLocation ?? "") ===
      normalizeQualityText(fixture.expectedLocation ?? "")
    : null;
  const requiredGroups = new Set(fixture.requiredDescriptionFactGroups);
  const extractedGroups = new Set(observation.extractedFactGroups);
  const matchedGroups = [...requiredGroups].filter((group) =>
    extractedGroups.has(group),
  ).length;
  const descriptionCoverage = requiredGroups.size
    ? matchedGroups / requiredGroups.size
    : null;

  return {
    titleAccepted,
    locationExpected,
    locationCorrect,
    descriptionCoverage,
    descriptionMateriallyComplete:
      descriptionCoverage === null ? null : descriptionCoverage === 1,
    fallbackCorrect:
      fixture.expectedParserFallback === observation.usedManualFallback &&
      observation.fabricatedFieldCount === 0,
  };
}

export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new RangeError(
      "percentile must be greater than 0 and no greater than 1",
    );
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1] ?? null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

export function calculatePilotReport(
  assessments: readonly PilotAssessment[],
): PilotReport {
  const cleanEligibleAssessments = assessments.filter(
    (assessment) => assessment.cleanEligible,
  );
  const terminalLatencies = cleanEligibleAssessments
    .map((assessment) => assessment.terminalLatencyMs)
    .filter(isFiniteNumber);
  const baselineComparisons = cleanEligibleAssessments.filter(
    (assessment) =>
      isFiniteNumber(assessment.automaticBuilderMs) &&
      isFiniteNumber(assessment.manualBaselineMs),
  );
  const automaticBuilderTimes = baselineComparisons.map(
    (assessment) => assessment.automaticBuilderMs as number,
  );
  const manualBaselineTimes = baselineComparisons.map(
    (assessment) => assessment.manualBaselineMs as number,
  );
  const terminalLatencyP95Ms = nearestRankPercentile(terminalLatencies, 0.95);
  const medianAutomaticBuilderMs = median(automaticBuilderTimes);
  const medianManualBaselineMs = median(manualBaselineTimes);

  const fallbackLabelledAssessments = assessments.filter(
    (assessment) =>
      assessment.expectedManualFallback !== undefined &&
      assessment.fabricatedFieldCount !== undefined,
  );
  const fallbackCorrect = fallbackLabelledAssessments.filter(
    (assessment) =>
      assessment.expectedManualFallback === assessment.manualFallbackUsed &&
      (!assessment.manualFallbackUsed ||
        assessment.fabricatedFieldCount === 0),
  ).length;
  const fallbackPrecision = ratio(
    fallbackCorrect,
    fallbackLabelledAssessments.length,
  );
  const readyAssessments = assessments.filter(
    (assessment) => assessment.cleanEligible,
  );
  const convertedWithin24h = readyAssessments.filter((assessment) =>
    isWithinWindow(
      assessment.uploadCompletedAt,
      assessment.convertedAt,
      CONVERSION_WINDOW_MS,
    ),
  ).length;
  const conversionWithin24hRate = ratio(
    convertedWithin24h,
    readyAssessments.length,
  );
  const deletionAssessments = assessments;
  const deletionSlaBreaches = deletionAssessments.filter((assessment) => {
    const deletionRequiredAt = toEpoch(assessment.deletionRequiredAt);
    const deletedAt = toEpoch(assessment.deletedAt);
    return (
      deletionRequiredAt === null ||
      deletedAt === null ||
      !assessment.deletionVerified ||
      deletedAt - deletionRequiredAt > DELETION_SLA_LIMIT_MS
    );
  }).length;
  const duplicateJobCount = assessments.reduce(
    (total, assessment) => total + Math.max(0, assessment.jobCount - 1),
    0,
  );
  const duplicateDraftCount = assessments.reduce(
    (total, assessment) => total + Math.max(0, assessment.draftCount - 1),
    0,
  );
  const baselineImprovement =
    medianAutomaticBuilderMs !== null &&
    medianManualBaselineMs !== null &&
    medianManualBaselineMs > 0
      ? 1 - medianAutomaticBuilderMs / medianManualBaselineMs
      : null;

  const gates: Record<PilotGateName, QualityGate> = {
    clean_terminal_p95: latencyGate(
      "p95 clean intake terminal latency",
      assessments.length,
      terminalLatencyP95Ms,
      TERMINAL_LATENCY_P95_LIMIT_MS,
      terminalLatencies.length,
      cleanEligibleAssessments.length,
    ),
    fallback_precision: completeRatioGate(
      "expected documents routed to manual fallback without fabricated fields",
      fallbackCorrect,
      fallbackLabelledAssessments.length,
      1,
      assessments.length,
      fallbackLabelledAssessments.length,
      assessments.length,
    ),
    title_acceptance: ratioGate(
      "acceptable title rate",
      cleanEligibleAssessments.filter(
        (assessment) => assessment.titleAcceptable === true,
      ).length,
      cleanEligibleAssessments.filter(
        (assessment) => assessment.titleAcceptable !== undefined,
      ).length,
      0.9,
      assessments.length,
      cleanEligibleAssessments.length,
    ),
    description_completeness: ratioGate(
      "materially complete description rate",
      cleanEligibleAssessments.filter(
        (assessment) => assessment.descriptionMateriallyComplete === true,
      ).length,
      cleanEligibleAssessments.filter(
        (assessment) => assessment.descriptionMateriallyComplete !== undefined,
      ).length,
      0.8,
      assessments.length,
      cleanEligibleAssessments.length,
    ),
    conversion_within_24h: ratioGate(
      "conversion within 24 hours",
      convertedWithin24h,
      readyAssessments.length,
      0.5,
      assessments.length,
    ),
    deletion_sla: ratioGate(
      "raw object deletion within 24 hours",
      deletionAssessments.length - deletionSlaBreaches,
      deletionAssessments.length,
      1,
      assessments.length,
    ),
    duplicate_jobs_and_drafts: zeroGate(
      "duplicate Jobs and Drafts",
      duplicateJobCount + duplicateDraftCount,
      assessments.length,
    ),
    manual_baseline_improvement: completeValueGate(
      "automatic builder speed improvement versus manual baseline",
      baselineImprovement,
      0.3,
      assessments.length,
      baselineComparisons.length,
      cleanEligibleAssessments.length,
    ),
  };

  return {
    sampleSize: assessments.length,
    terminalLatencyP95Ms,
    medianAutomaticBuilderMs,
    medianManualBaselineMs,
    conversionWithin24hRate,
    fallbackPrecision,
    deletionSlaBreaches: deletionAssessments.length
      ? deletionSlaBreaches
      : null,
    duplicateJobCount,
    duplicateDraftCount,
    gates,
  };
}

function ratio(value: number, denominator: number): number | null {
  return denominator > 0 ? value / denominator : null;
}

function ratioGate(
  reason: string,
  numerator: number,
  denominator: number,
  threshold: number,
  sampleSize: number,
  minimumDenominator = 1,
): QualityGate {
  const value = ratio(numerator, denominator);
  if (
    sampleSize < PILOT_ASSESSMENT_MINIMUM ||
    denominator < minimumDenominator ||
    value === null
  ) {
    return insufficientGate(reason, value, threshold, numerator, denominator);
  }
  return measuredGate(reason, value, threshold, numerator, denominator);
}

function completeRatioGate(
  reason: string,
  numerator: number,
  denominator: number,
  threshold: number,
  sampleSize: number,
  measuredCount: number,
  expectedCount: number,
): QualityGate {
  const value = ratio(numerator, denominator);
  if (
    sampleSize < PILOT_ASSESSMENT_MINIMUM ||
    measuredCount !== expectedCount ||
    denominator === 0 ||
    value === null
  ) {
    return insufficientGate(reason, value, threshold, numerator, denominator);
  }
  return measuredGate(reason, value, threshold, numerator, denominator);
}

function latencyGate(
  reason: string,
  sampleSize: number,
  value: number | null,
  threshold: number,
  measuredCount: number,
  expectedCount: number,
): QualityGate {
  if (
    sampleSize < PILOT_ASSESSMENT_MINIMUM ||
    measuredCount === 0 ||
    measuredCount < expectedCount ||
    value === null
  ) {
    return insufficientGate(
      reason,
      value,
      threshold,
      measuredCount,
      expectedCount,
    );
  }
  return {
    status: value <= threshold ? "pass" : "fail",
    value,
    threshold,
    numerator: measuredCount,
    denominator: expectedCount,
    reason,
  };
}

function completeValueGate(
  reason: string,
  value: number | null,
  threshold: number,
  sampleSize: number,
  measuredCount: number,
  expectedCount: number,
): QualityGate {
  if (
    sampleSize < PILOT_ASSESSMENT_MINIMUM ||
    value === null ||
    measuredCount === 0 ||
    measuredCount !== expectedCount
  ) {
    return insufficientGate(
      reason,
      value,
      threshold,
      measuredCount,
      expectedCount,
    );
  }
  return measuredGate(reason, value, threshold, measuredCount, expectedCount);
}

function zeroGate(
  reason: string,
  count: number,
  sampleSize: number,
): QualityGate {
  if (sampleSize < PILOT_ASSESSMENT_MINIMUM) {
    return insufficientGate(reason, count, 0, count, sampleSize);
  }
  return {
    status: count === 0 ? "pass" : "fail",
    value: count,
    threshold: 0,
    numerator: count,
    denominator: sampleSize,
    reason,
  };
}

function insufficientGate(
  reason: string,
  value: number | null,
  threshold: number | null,
  numerator: number | null,
  denominator: number | null,
): QualityGate {
  return {
    status: "insufficient_data",
    value,
    threshold,
    numerator,
    denominator,
    reason: `${reason}: requires ${PILOT_ASSESSMENT_MINIMUM} pilot assessments and complete evidence`,
  };
}

function measuredGate(
  reason: string,
  value: number,
  threshold: number,
  numerator: number,
  denominator: number,
): QualityGate {
  return {
    status: value >= threshold ? "pass" : "fail",
    value,
    threshold,
    numerator,
    denominator,
    reason,
  };
}

function isWithinWindow(
  start: string | Date | undefined,
  end: string | Date | undefined,
  windowMs: number,
): boolean {
  const startMs = toEpoch(start);
  const endMs = toEpoch(end);
  return (
    startMs !== null &&
    endMs !== null &&
    endMs >= startMs &&
    endMs - startMs <= windowMs
  );
}

function toEpoch(value: string | Date | undefined): number | null {
  if (value === undefined) return null;
  const epoch = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}
