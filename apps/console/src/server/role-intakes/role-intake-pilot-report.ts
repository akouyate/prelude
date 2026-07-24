import { readFile } from "node:fs/promises";

import { prisma } from "@prelude/db";

import {
  parseRoleIntakePilotOrganizationIds,
  parseRoleIntakePilotStartedAt,
} from "../../domain/role-intake-policy";
import {
  buildPilotAssessment,
  parseRoleIntakeManualAssessment,
  type RoleIntakeManualAssessment,
} from "./role-intake-pilot";
import { calculatePilotReport } from "./role-intake-quality";

async function main(): Promise<void> {
  const organizationIds = parseRoleIntakePilotOrganizationIds();
  if (organizationIds.length === 0) {
    throw new Error(
      "Set ROLE_INTAKE_PILOT_ORGANIZATION_IDS to one to five opted-in organization IDs.",
    );
  }
  const pilotStartedAt = parseRoleIntakePilotStartedAt();
  if (!pilotStartedAt) {
    throw new Error(
      "Set ROLE_INTAKE_PILOT_STARTED_AT to the controlled pilot start time in ISO 8601 UTC format.",
    );
  }

  const manualAssessments = await readManualAssessments(process.argv[2]);
  const intakes = await prisma.roleIntake.findMany({
    include: {
      events: { orderBy: { createdAt: "asc" } },
      job: {
        select: {
          id: true,
          interviewDrafts: {
            select: { id: true, originRoleIntakeId: true },
            where: { originRoleIntakeId: { not: null } },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
    where: {
      createdAt: { gte: pilotStartedAt },
      organizationId: { in: organizationIds },
      sourceKind: "file",
      status: {
        in: ["ready_for_review", "consumed", "failed", "expired"],
      },
    },
  });
  const cohortIds = new Set(intakes.map((intake) => intake.id));
  if (
    [...manualAssessments.keys()].some(
      (assessmentId) => !cohortIds.has(assessmentId),
    )
  ) {
    throw new Error(
      "The pilot assessment file contains IDs outside the selected cohort.",
    );
  }
  const assessments = intakes.map((intake) =>
    buildPilotAssessment(
      {
        cleanedUpAt: intake.cleanedUpAt,
        cleanupRequestedAt: intake.cleanupRequestedAt,
        createdAt: intake.createdAt,
        draftCount:
          intake.job?.interviewDrafts.filter(
            (draft) => draft.originRoleIntakeId === intake.id,
          ).length ?? 0,
        events: intake.events,
        id: intake.id,
        jobCount: intake.job ? 1 : 0,
        status: intake.status,
        updatedAt: intake.updatedAt,
      },
      manualAssessments.get(intake.id),
    ),
  );

  process.stdout.write(
    `${JSON.stringify(calculatePilotReport(assessments), null, 2)}\n`,
  );
}

async function readManualAssessments(
  path: string | undefined,
): Promise<Map<string, RoleIntakeManualAssessment>> {
  if (!path) {
    return new Map();
  }
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("The pilot assessment file must contain a JSON array.");
  }

  const assessments = parsed.map(parseRoleIntakeManualAssessment);
  const byId = new Map(
    assessments.map((assessment) => [assessment.assessmentId, assessment]),
  );
  if (byId.size !== assessments.length) {
    throw new Error("Each pilot assessment ID must be unique.");
  }
  return byId;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Pilot report failed."}\n`,
  );
  process.exitCode = 1;
});
