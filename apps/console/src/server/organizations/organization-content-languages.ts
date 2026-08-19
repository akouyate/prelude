import type { WorkspaceLanguage } from "@prelude/contracts";
import { prisma, type Prisma } from "@prelude/db";

import { parseOrganizationSettings } from "../settings/workspace-settings-data";
import {
  resolveInterviewLanguage,
  resolveWorkspaceLanguage,
} from "./content-language";

/**
 * The two language facts a workspace owns (plan 2026-08-18, rule 1).
 *
 * They are deliberately separate: `interviewDefault` seeds a draft's stamp and
 * ends up as candidate-facing copy, while `workspace` governs the shared
 * recruiter-bound analysis. Reading them together — through the same
 * `parseOrganizationSettings` the settings page uses — keeps the generation path
 * from re-deriving the settings shape on its own.
 */
export type OrganizationContentLanguages = {
  interviewDefault: WorkspaceLanguage;
  workspace: WorkspaceLanguage;
};

export function readOrganizationContentLanguages(
  settings: Prisma.JsonValue,
): OrganizationContentLanguages {
  const preferences = parseOrganizationSettings(settings);

  return {
    interviewDefault: resolveInterviewLanguage(
      null,
      preferences.interview.defaultLanguage,
    ),
    workspace: resolveWorkspaceLanguage(preferences.workspaceLanguage),
  };
}

export async function loadOrganizationContentLanguages(
  organizationId: string,
): Promise<OrganizationContentLanguages> {
  const organization = await prisma.organization.findUnique({
    select: { settings: true },
    where: { id: organizationId },
  });

  return readOrganizationContentLanguages(organization?.settings ?? null);
}
