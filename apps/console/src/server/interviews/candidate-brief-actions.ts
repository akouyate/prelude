"use server";

import { revalidatePath } from "next/cache";

import { generateCandidateBriefForSession } from "./candidate-brief-generation";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export async function generateCandidateBriefAction(formData: FormData) {
  const candidateSessionId = String(formData.get("candidateSessionId") ?? "");
  const detailPath = String(formData.get("detailPath") ?? "");
  if (!candidateSessionId) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  await generateCandidateBriefForSession({
    candidateSessionId,
    organizationId: scope.organizationId,
  });
  revalidatePath(`/interviews/${candidateSessionId}`);
  if (detailPath.startsWith("/interviews/")) {
    revalidatePath(detailPath);
  }
}
