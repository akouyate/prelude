"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validateCandidateCallSchedule } from "../../domain/candidate-call-scheduling-policy";
import { createGoogleCalendarAuthorizationUrl } from "../integrations/connected-account-service";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import {
  CandidateCallSchedulingError,
  scheduleCandidateCall,
} from "./candidate-call-scheduling";

export type ScheduleCandidateCallActionState = {
  code: "reconnect_required" | null;
  error: string | null;
  scheduled: {
    conferenceJoinUrl: string | null;
    conferencePending: boolean;
    eventUrl: string | null;
    invitationSent: boolean;
    startsAt: string;
    status: "scheduled";
    timeZone: string;
  } | null;
};

export async function scheduleCandidateCallAction(
  _previousState: ScheduleCandidateCallActionState,
  formData: FormData,
): Promise<ScheduleCandidateCallActionState> {
  const candidateSessionId = String(formData.get("candidateSessionId") ?? "");
  const detailPath = String(formData.get("detailPath") ?? "");
  if (!candidateSessionId) {
    return {
      code: null,
      error: "Candidate session is required.",
      scheduled: null,
    };
  }

  const parsed = validateCandidateCallSchedule({
    addConference: formData.get("addConference"),
    candidateEmail: formData.get("candidateEmail"),
    durationMinutes: formData.get("durationMinutes"),
    guestEmails: formData.get("guestEmails"),
    inviteCandidate: formData.get("inviteCandidate"),
    location: formData.get("location"),
    startsAt: formData.get("startsAt"),
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.ok) {
    return { code: null, error: parsed.error, scheduled: null };
  }

  try {
    const scope = await getCompletedOrganizationScope();
    const scheduled = await scheduleCandidateCall({
      actorRole: scope.role,
      actorUserId: scope.userId,
      candidateSessionId,
      organizationId: scope.organizationId,
      schedule: parsed.value,
    });

    revalidatePath("/");
    revalidatePath(`/interviews/${candidateSessionId}`);
    if (detailPath.startsWith("/interviews/")) {
      revalidatePath(detailPath);
    }

    return {
      code: null,
      error: null,
      scheduled: { ...scheduled, status: "scheduled" },
    };
  } catch (error) {
    return {
      code:
        error instanceof CandidateCallSchedulingError &&
        error.code === "reconnect_required"
          ? "reconnect_required"
          : null,
      error:
        error instanceof CandidateCallSchedulingError
          ? error.message
          : "Unable to schedule this call. Please try again.",
      scheduled: null,
    };
  }
}

export async function connectGoogleCalendarForCandidateAction(
  formData: FormData,
) {
  const returnTo = String(formData.get("detailPath") ?? "");
  const result = await createGoogleCalendarAuthorizationUrl({ returnTo });

  if (result.ok) {
    redirect(result.url);
  }

  redirect(
    returnTo.startsWith("/interviews/")
      ? `${returnTo}?calendar=connect_failed`
      : "/settings?view=integrations&provider=google_calendar&status=missing_config",
  );
}
