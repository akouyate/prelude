"use server";

import { prisma } from "@prelude/db";
import { revalidatePath } from "next/cache";

import { canDeleteRecording } from "../../domain/recording-policy";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

// The console reaches the Go realtime API the same way the candidate app does.
// Resolved per call (not at module load) so the URL reflects the live env.
function realtimeApiUrl() {
  return process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";
}

// deleteRecordingAction is the recruiter-facing right-to-erasure trigger. It does
// NOT tombstone the row itself: the Go realtime service owns deletion because it
// removes the actual R2 audio object before tombstoning. The console has no
// object-delete credentials, and a local tombstone would orphan the audio. So
// this action authorizes + scopes the request, then delegates to the Go endpoint.
export async function deleteRecordingAction({
  candidateSessionId,
}: {
  candidateSessionId: string;
}) {
  if (!candidateSessionId) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  if (!canDeleteRecording(scope.role)) {
    throw new Error("Only owners and admins can delete a recording.");
  }

  // Scope to the caller's organization: a session in another org is invisible.
  const session = await prisma.candidateSession.findFirst({
    select: { realtimeSessionId: true },
    where: { id: candidateSessionId, organizationId: scope.organizationId },
  });
  if (!session?.realtimeSessionId) {
    // No live session recorded for this candidate (or not in this org) — nothing
    // to erase.
    return;
  }

  const response = await fetch(
    `${realtimeApiUrl()}/v1/interview-sessions/${encodeURIComponent(
      session.realtimeSessionId,
    )}/recordings`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error("Failed to delete the recording. Please try again.");
  }

  // The detail route resolves to realtimeSessionId when present, else the product
  // id (see the interview detail page), so revalidate both.
  revalidatePath(`/interviews/${candidateSessionId}`);
  revalidatePath(`/interviews/${session.realtimeSessionId}`);
}
