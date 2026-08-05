"use server";

import { revalidatePath } from "next/cache";

import {
  createCandidateInvitationForInterview,
  reissueCandidateInvitation,
} from "./candidate-invitations";
import {
  hasCandidateInvitationErrors,
  validateCandidateInvitation,
  type CandidateInvitationFieldErrors,
} from "../../domain/candidate-invitation-policy";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type CandidateInvitationActionState = {
  error: string | null;
  fieldErrors: CandidateInvitationFieldErrors;
  ok: boolean;
};

export async function createCandidateInvitationAction(
  _state: CandidateInvitationActionState,
  formData: FormData,
): Promise<CandidateInvitationActionState> {
  const interviewId = String(formData.get("interviewId") ?? "").trim();

  if (!interviewId) {
    return { error: "Missing role screen.", fieldErrors: {}, ok: false };
  }

  const candidateEmail = String(formData.get("candidateEmail") ?? "");
  const candidateName = String(formData.get("candidateName") ?? "");
  const expiresAt = String(formData.get("expiresAt") ?? "");
  const fieldErrors = validateCandidateInvitation(
    { candidateEmail, candidateName, expiresAt },
    new Date(),
  );
  if (hasCandidateInvitationErrors(fieldErrors)) {
    return { error: null, fieldErrors, ok: false };
  }

  const scope = await getCompletedOrganizationScope();
  const result = await createCandidateInvitationForInterview({
    actorRole: scope.role,
    candidateEmail,
    candidateName,
    expiresAt: parseExpiryDate(expiresAt),
    interviewId,
    organizationId: scope.organizationId,
  });

  if (!result.ok) {
    return { error: result.error, fieldErrors: {}, ok: false };
  }

  revalidatePath("/");
  revalidatePath("/roles");
  revalidatePath(`/roles/${interviewId}`);

  return { error: null, fieldErrors: {}, ok: true };
}

export async function reissueCandidateInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  const interviewId = String(formData.get("interviewId") ?? "").trim();

  if (!invitationId || !interviewId) {
    return;
  }

  const scope = await getCompletedOrganizationScope();
  await reissueCandidateInvitation({
    actorRole: scope.role,
    invitationId,
    organizationId: scope.organizationId,
  });

  revalidatePath("/");
  revalidatePath("/roles");
  revalidatePath(`/roles/${interviewId}`);
}

function parseExpiryDate(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
