"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { validateCandidateCallSchedule } from "../../domain/candidate-call-scheduling-policy";
import type { ScheduledCallSummary } from "../../features/interview-detail/scheduled-call-presentation";
import { createGoogleCalendarAuthorizationUrl } from "../integrations/connected-account-service";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import {
  CandidateCallSchedulingError,
  scheduleCandidateCall,
} from "./candidate-call-scheduling";

/**
 * `code` is what the dialog renders its own copy from. The service's messages
 * are written for a server log, and the two refusals a reschedule can hit need
 * more than a sentence — where to go instead, and who can go there — so the
 * code travels and the console owns the wording (and its translation).
 */
export type ScheduleCandidateCallActionState = {
  code:
    | "not_calendar_owner"
    | "reconnect_required"
    | "reschedule_unsupported"
    | null;
  error: string | null;
  /**
   * The whole booked call, because that is what the success path below hands
   * back — the service's summary, spread verbatim. The hand-written subset
   * that used to stand here listed seven of those twelve fields, so the type
   * was already describing something other than the value flowing through it.
   *
   * `status` is the one field genuinely narrower than the summary's: this is
   * only ever set on the path where the provider confirmed the event.
   */
  scheduled:
    | (Omit<ScheduledCallSummary, "status"> & { status: "scheduled" })
    | null;
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
      code: toActionCode(error),
      error:
        error instanceof CandidateCallSchedulingError
          ? error.message
          : "Unable to schedule this call. Please try again.",
      scheduled: null,
    };
  }
}

function toActionCode(
  error: unknown,
): ScheduleCandidateCallActionState["code"] {
  if (!(error instanceof CandidateCallSchedulingError)) {
    return null;
  }

  return error.code === "not_calendar_owner" ||
    error.code === "reconnect_required" ||
    error.code === "reschedule_unsupported"
    ? error.code
    : null;
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
