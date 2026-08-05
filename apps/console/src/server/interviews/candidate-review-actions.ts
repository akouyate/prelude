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

// Inline queue actions (dashboard): flip the human review status in place and
// keep the recruiter on the queue. The stored note is intentionally untouched.
export async function updateCandidateReviewStatusAction(formData: FormData) {
  const candidateSessionId = String(formData.get("candidateSessionId") ?? "");
  const nextStatus = String(formData.get("reviewStatus") ?? "");

  if (!candidateSessionId || !nextStatus) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  await updateCandidateSessionReview({
    actorRole: scope.role,
    actorUserId: scope.userId,
    candidateSessionId,
    nextStatus,
    organizationId: scope.organizationId,
  });

  revalidatePath("/");
  revalidatePath("/candidates");
  revalidatePath(`/interviews/${candidateSessionId}`);
}

// Note autosave on the candidate review page: writes the note only and leaves
// the human review decision untouched.
export async function saveCandidateReviewNoteAction({
  candidateSessionId,
  detailPath,
  reviewNote,
}: {
  candidateSessionId: string;
  detailPath: string;
  reviewNote: string;
}) {
  if (!candidateSessionId) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  await updateCandidateSessionReview({
    actorRole: scope.role,
    actorUserId: scope.userId,
    candidateSessionId,
    nextNote: reviewNote,
    organizationId: scope.organizationId,
  });

  if (detailPath.startsWith("/interviews/")) {
    revalidatePath(detailPath);
  }
}
