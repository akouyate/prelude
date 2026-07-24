import type { PilotAssessment } from "./role-intake-quality";

type PilotEventRecord = {
  createdAt: Date;
  eventType: string;
  metadata: unknown;
};

export type RoleIntakePilotRecord = {
  cleanedUpAt: Date | null;
  cleanupRequestedAt: Date | null;
  createdAt: Date;
  draftCount: number;
  events: readonly PilotEventRecord[];
  id: string;
  jobCount: number;
  status: string;
  updatedAt: Date;
};

export type RoleIntakeManualAssessment = {
  assessmentId: string;
  assessedAt?: string | Date;
  cleanEligible: boolean;
  descriptionMateriallyComplete: boolean;
  expectedManualFallback: boolean;
  fabricatedFieldCount: number;
  manualBaselineMs?: number;
  titleAcceptable: boolean;
};

export function parseRoleIntakeManualAssessment(
  value: unknown,
): RoleIntakeManualAssessment {
  if (!isRecord(value) || typeof value.assessmentId !== "string") {
    throw new Error("Every pilot assessment requires an assessmentId.");
  }
  const allowedKeys = new Set([
    "assessmentId",
    "assessedAt",
    "cleanEligible",
    "descriptionMateriallyComplete",
    "expectedManualFallback",
    "fabricatedFieldCount",
    "manualBaselineMs",
    "titleAcceptable",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(
      `Pilot assessment ${value.assessmentId} contains unsupported fields.`,
    );
  }
  if (
    typeof value.cleanEligible !== "boolean" ||
    typeof value.titleAcceptable !== "boolean" ||
    typeof value.descriptionMateriallyComplete !== "boolean" ||
    typeof value.expectedManualFallback !== "boolean" ||
    !Number.isInteger(value.fabricatedFieldCount) ||
    Number(value.fabricatedFieldCount) < 0
  ) {
    throw new Error(
      `Pilot assessment ${value.assessmentId} has invalid categorical labels.`,
    );
  }
  if (
    value.manualBaselineMs !== undefined &&
    (!Number.isFinite(value.manualBaselineMs) ||
      Number(value.manualBaselineMs) < 0)
  ) {
    throw new Error(
      `Pilot assessment ${value.assessmentId} has an invalid manual baseline.`,
    );
  }
  return {
    assessedAt:
      typeof value.assessedAt === "string" ? value.assessedAt : undefined,
    assessmentId: value.assessmentId,
    cleanEligible: value.cleanEligible,
    descriptionMateriallyComplete: value.descriptionMateriallyComplete,
    expectedManualFallback: value.expectedManualFallback,
    fabricatedFieldCount: Number(value.fabricatedFieldCount),
    manualBaselineMs:
      value.manualBaselineMs === undefined
        ? undefined
        : Number(value.manualBaselineMs),
    titleAcceptable: value.titleAcceptable,
  };
}

export function buildPilotAssessment(
  intake: RoleIntakePilotRecord,
  manual?: RoleIntakeManualAssessment,
): PilotAssessment {
  if (manual && manual.assessmentId !== intake.id) {
    throw new Error("The manual assessment does not match this intake.");
  }

  const upload = firstEvent(intake.events, "role_intake_upload_completed");
  const extraction = lastEvent(
    intake.events,
    "role_intake_extraction_completed",
  );
  const conversion = intake.events.find(
    (event) =>
      event.eventType === "role_intake_converted" &&
      stringMetadata(event, "outcome") === "converted",
  );
  const objectDeleted = lastEvent(
    intake.events,
    "role_intake_object_deleted",
  );
  const extractionOutcome = stringMetadata(extraction, "outcome");
  const terminalAt =
    extraction?.createdAt ??
    (isTerminalStatus(intake.status) ? intake.updatedAt : undefined);
  const deletionRequiredAt =
    intake.status === "failed" || intake.status === "expired"
      ? (intake.cleanupRequestedAt ?? undefined)
      : upload?.createdAt;

  return {
    assessmentId: intake.id,
    assessedAt: manual?.assessedAt ?? intake.updatedAt,
    automaticBuilderMs: elapsedBetween(
      upload?.createdAt,
      conversion?.createdAt,
    ),
    cleanEligible: manual?.cleanEligible === true,
    convertedAt: conversion?.createdAt,
    deletedAt: objectDeleted?.createdAt,
    deletionRequiredAt,
    deletionVerified: objectDeleted !== undefined,
    descriptionMateriallyComplete: manual?.descriptionMateriallyComplete,
    draftCount: intake.draftCount,
    expectedManualFallback: manual?.expectedManualFallback,
    fabricatedFieldCount: manual?.fabricatedFieldCount,
    jobCount: intake.jobCount,
    manualBaselineMs: manual?.manualBaselineMs,
    manualFallbackUsed: extractionOutcome === "manual_fallback",
    terminalAt,
    terminalLatencyMs: elapsedBetween(upload?.createdAt, terminalAt),
    titleAcceptable: manual?.titleAcceptable,
    uploadCompletedAt: upload?.createdAt,
  };
}

function firstEvent(
  events: readonly PilotEventRecord[],
  eventType: string,
): PilotEventRecord | undefined {
  return events.find((event) => event.eventType === eventType);
}

function lastEvent(
  events: readonly PilotEventRecord[],
  eventType: string,
): PilotEventRecord | undefined {
  return [...events].reverse().find((event) => event.eventType === eventType);
}

function stringMetadata(
  event: PilotEventRecord | undefined,
  field: string,
): string | undefined {
  if (
    !event?.metadata ||
    typeof event.metadata !== "object" ||
    Array.isArray(event.metadata)
  ) {
    return undefined;
  }
  const value = (event.metadata as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function elapsedBetween(
  start: Date | undefined,
  end: Date | undefined,
): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  return Math.max(0, end.getTime() - start.getTime());
}

function isTerminalStatus(status: string): boolean {
  return ["consumed", "expired", "failed", "ready_for_review"].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
