"use server";

import { revalidatePath } from "next/cache";

import {
  createCandidateInvitationForInterview,
  reissueCandidateInvitation,
} from "./candidate-invitations";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type CandidateInvitationActionState = {
  error: string | null;
  ok: boolean;
};

export async function createCandidateInvitationAction(
  _state: CandidateInvitationActionState,
  formData: FormData,
): Promise<CandidateInvitationActionState> {
  const interviewId = String(formData.get("interviewId") ?? "").trim();

  if (!interviewId) {
    return { error: "Missing role screen.", ok: false };
  }

  const scope = await getCompletedOrganizationScope();
  const result = await createCandidateInvitationForInterview({
    actorRole: scope.role,
    candidateEmail: String(formData.get("candidateEmail") ?? ""),
    candidateName: String(formData.get("candidateName") ?? ""),
    expiresAt: parseExpiryDate(String(formData.get("expiresAt") ?? "")),
    interviewId,
    organizationId: scope.organizationId,
  });

  if (!result.ok) {
    return { error: result.error, ok: false };
  }

  revalidatePath("/");
  revalidatePath("/roles");
  revalidatePath(`/roles/${interviewId}`);

  return { error: null, ok: true };
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
