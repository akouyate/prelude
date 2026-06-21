"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updateCandidateSessionReview } from "./candidate-review-workflow";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export async function updateCandidateReviewAction(formData: FormData) {
  const candidateSessionId = String(formData.get("candidateSessionId") ?? "");
  const detailPath = String(formData.get("detailPath") ?? "");
  const nextStatus = String(formData.get("reviewStatus") ?? "");
  const nextNote = String(formData.get("reviewNote") ?? "");

  if (!candidateSessionId) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  await updateCandidateSessionReview({
    actorRole: scope.role,
    actorUserId: scope.userId,
    candidateSessionId,
    nextNote,
    nextStatus,
    organizationId: scope.organizationId,
  });

  revalidatePath("/");
  revalidatePath(`/interviews/${candidateSessionId}`);
  if (detailPath.startsWith("/interviews/")) {
    revalidatePath(detailPath);
    redirect(detailPath);
  }

  redirect(`/interviews/${candidateSessionId}`);
}
