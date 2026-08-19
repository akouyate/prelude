"use server";

import { revalidatePath } from "next/cache";

import { canEraseCandidateData } from "../../domain/candidate-erasure-policy";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import {
  eraseCandidateSessionData,
  erasureReasonRequest,
} from "./candidate-erasure";

/**
 * The recruiter-facing right to erasure. The hiring organization is the data
 * controller, so it must be able to EXECUTE the right its own privacy notice
 * promises — not merely forward the request to privacy@hirecall.ai and wait.
 *
 * This action only authorizes and scopes; the erasure itself lives in
 * `candidate-erasure.ts`, shared byte-for-byte with the 12-month retention
 * sweep, so the two can never write a different tombstone.
 */
export async function eraseCandidateDataAction({
  candidateSessionId,
}: {
  candidateSessionId: string;
}) {
  if (!candidateSessionId) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  if (!canEraseCandidateData(scope.role)) {
    throw new Error("Only owners and admins can erase a candidate's data.");
  }

  const result = await eraseCandidateSessionData({
    candidateSessionId,
    organizationId: scope.organizationId,
    reason: erasureReasonRequest,
  });
  if (!result.erased) {
    // Not in this organization, or already gone. Nothing was written, so there
    // is nothing to revalidate — and nothing to report either, since telling the
    // caller which is which would confirm a session id it may not own.
    return;
  }

  // The detail route resolves to realtimeSessionId when present, else the
  // product id (see the interview detail page), so revalidate both — the
  // recruiter may be standing on either URL. The candidates list carries the
  // candidate's name too, so it is stale the moment the name is gone.
  revalidatePath(`/interviews/${candidateSessionId}`);
  if (result.realtimeSessionId) {
    revalidatePath(`/interviews/${result.realtimeSessionId}`);
  }
  revalidatePath("/candidates");
}
