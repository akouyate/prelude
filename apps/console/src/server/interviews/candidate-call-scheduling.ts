import "server-only";

import { randomUUID } from "node:crypto";

import { prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { canManageCandidateReview } from "../../domain/candidate-review-policy";
import type { ValidatedCandidateCallSchedule } from "../../domain/candidate-call-scheduling-policy";
import type { ScheduledCallSummary } from "../../features/interview-detail/scheduled-call-presentation";
import { normalizeEmail } from "../../libs/email";
import {
  CalendarProviderError,
  type CalendarEventResult,
  type CalendarProvider,
} from "../integrations/calendar-provider";
import {
  getGoogleCalendarConnection,
  markGoogleCalendarConnectionNeedsReconnect,
} from "../integrations/connected-account-service";
import { createGoogleCalendarProvider } from "../integrations/google-calendar-provider";

/**
 * The booked call as the console reads it — one record for both jobs the
 * client has: announcing the call in the banner, and reopening the scheduling
 * form on it. Those two must never disagree, so they read the same shape.
 *
 * The second job is why the guest list, the interval and the conference choice
 * are here rather than only the headline facts: the server treats a submitted
 * schedule as the COMPLETE state of the event, so the form can only be honest
 * about a move if it can start from everything the row already holds.
 *
 * So it is the client's own declaration, aliased rather than copied out: a
 * second hand-written list of these twelve fields is exactly the drift this
 * record cannot afford. `import type` is erased at build time, so nothing of
 * `server-only` travels back the other way.
 */
export type CandidateScheduledCallSummary = ScheduledCallSummary;

export class CandidateCallSchedulingError extends Error {
  readonly code:
    | "already_scheduled"
    | "not_calendar_owner"
    | "not_connected"
    | "not_ready"
    | "provider_error"
    | "reconnect_required"
    | "reschedule_unsupported"
    | "unauthorized";

  constructor(message: string, code: CandidateCallSchedulingError["code"]) {
    super(message);
    this.name = "CandidateCallSchedulingError";
    this.code = code;
  }
}

export async function scheduleCandidateCall(input: {
  actorRole: OrganizationRole;
  actorUserId: string;
  candidateSessionId: string;
  organizationId: string;
  schedule: ValidatedCandidateCallSchedule;
  providerFactory?: (accessToken: string) => CalendarProvider;
}): Promise<CandidateScheduledCallSummary> {
  if (!canManageCandidateReview(input.actorRole)) {
    throw new CandidateCallSchedulingError(
      "Viewer role cannot schedule candidate calls.",
      "unauthorized",
    );
  }

  const [connection, session] = await Promise.all([
    getGoogleCalendarConnection({
      organizationId: input.organizationId,
      userId: input.actorUserId,
    }),
    prisma.candidateSession.findFirst({
      include: {
        candidateInvitation: true,
        interview: { select: { roleTitle: true } },
      },
      where: {
        id: input.candidateSessionId,
        organizationId: input.organizationId,
      },
    }),
  ]);

  if (!connection.ok) {
    const needsReconnect = ["needs_reconnect", "expired", "revoked"].includes(
      connection.status,
    );
    throw new CandidateCallSchedulingError(
      needsReconnect
        ? "Reconnect Google Calendar before scheduling a call."
        : "Connect Google Calendar before scheduling a call.",
      needsReconnect ? "reconnect_required" : "not_connected",
    );
  }

  if (!session) {
    throw new CandidateCallSchedulingError(
      "Candidate session was not found for this organization.",
      "unauthorized",
    );
  }

  if (session.reviewStatus !== "to_call") {
    throw new CandidateCallSchedulingError(
      "Move this candidate to To call before scheduling a follow-up.",
      "not_ready",
    );
  }

  const candidateLabel =
    session.candidateName ??
    session.candidateInvitation?.candidateName ??
    "Candidate";
  const persistedCandidateEmail = normalizeEmail(
    session.candidateEmail ?? session.candidateInvitation?.candidateEmail,
  );
  if (
    persistedCandidateEmail &&
    !input.schedule.inviteCandidate &&
    input.schedule.attendeeEmails.includes(persistedCandidateEmail)
  ) {
    throw new CandidateCallSchedulingError(
      "Enable the candidate invitation to add the candidate as a guest.",
      "not_ready",
    );
  }
  if (
    persistedCandidateEmail &&
    input.schedule.inviteCandidate &&
    input.schedule.candidateEmail !== persistedCandidateEmail
  ) {
    throw new CandidateCallSchedulingError(
      "The invitation must use the candidate email saved in HireCall.",
      "not_ready",
    );
  }
  const summary = `Follow-up call · ${candidateLabel} · ${session.interview.roleTitle}`;
  const callId = randomUUID();
  const providerEventId = randomUUID().replaceAll("-", "");

  const existingCall = await prisma.candidateScheduledCall.findFirst({
    where: { activeScheduleKey: session.id },
  });
  let call;

  const callData = {
    attendeeEmails: input.schedule.attendeeEmails,
    connectedAccountId: connection.accountId,
    conferenceRequested: input.schedule.addConference,
    endsAt: input.schedule.endsAt,
    inviteCandidate: input.schedule.inviteCandidate,
    location: input.schedule.location,
    startsAt: input.schedule.startsAt,
    summary,
    timeZone: input.schedule.timeZone,
  };

  if (
    existingCall &&
    (existingCall.status === "scheduled" ||
      existingCall.status === "rescheduling")
  ) {
    return rescheduleBookedCall({
      connection,
      existingCall,
      organizationId: input.organizationId,
      providerFactory: input.providerFactory,
      schedule: callData,
      userId: input.actorUserId,
    });
  }

  if (
    existingCall?.status === "provider_error" ||
    existingCall?.status === "creating"
  ) {
    if (!scheduleMatchesExistingCall(existingCall, callData)) {
      throw new CandidateCallSchedulingError(
        "A previous calendar request is still being reconciled. Retry using the original call details.",
        "provider_error",
      );
    }
    call = await prisma.candidateScheduledCall.update({
      data: {
        lastProviderErrorAt: null,
        lastProviderErrorCode: null,
        status: "creating",
      },
      where: { id: existingCall.id },
    });
  } else {
    try {
      call = await prisma.candidateScheduledCall.create({
        data: {
          activeScheduleKey: session.id,
          candidateSessionId: session.id,
          createdByUserId: input.actorUserId,
          id: callId,
          organizationId: input.organizationId,
          providerEventId,
          ...callData,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new CandidateCallSchedulingError(
          "A next call is already scheduled for this candidate.",
          "already_scheduled",
        );
      }
      throw error;
    }
  }

  const createEvent = (accessToken: string) =>
    (input.providerFactory ?? createGoogleCalendarProvider)(
      accessToken,
    ).createEvent({
      attendees: input.schedule.attendeeEmails,
      calendarId: "primary",
      conferenceRequestId: input.schedule.addConference
        ? `prelude-${call.id}`
        : null,
      description: "",
      endsAt: input.schedule.endsAt,
      eventId: call.providerEventId,
      location: input.schedule.location,
      privateExtendedProperties: {
        preludeCandidateSessionId: session.id,
      },
      startsAt: input.schedule.startsAt,
      summary,
      timeZone: input.schedule.timeZone,
    });

  try {
    const event = await runCalendarRequest(
      {
        accessToken: connection.accessToken,
        accountId: connection.accountId,
        organizationId: input.organizationId,
        userId: input.actorUserId,
      },
      createEvent,
    );

    const scheduled = await prisma.candidateScheduledCall.update({
      data: {
        conferenceJoinUrl: event.conferenceJoinUrl,
        conferenceStatus:
          input.schedule.addConference && !event.conferenceJoinUrl
            ? "pending"
            : input.schedule.addConference
              ? "ready"
              : null,
        providerEventId: event.eventId,
        providerEventUrl: event.eventUrl,
        status: "scheduled",
      },
      where: { id: call.id },
    });

    return toScheduledCallSummary(scheduled);
  } catch (error) {
    throw await recordProviderFailure({
      callId: call.id,
      error,
      message:
        "Google Calendar could not schedule this call. Please try again.",
      // Nothing exists on the calendar, so the row says so and the recruiter
      // keeps the create-retry path.
      status: "provider_error",
    });
  }
}

type BookedCall = {
  attendeeEmails: unknown;
  conferenceJoinUrl: string | null;
  conferenceRequested: boolean;
  conferenceStatus: string | null;
  connectedAccountId: string | null;
  endsAt: Date;
  id: string;
  inviteCandidate: boolean;
  location: string | null;
  providerEventId: string;
  providerEventUrl: string | null;
  startsAt: Date;
  status: string;
  timeZone: string;
};

type CallScheduleData = {
  attendeeEmails: string[];
  conferenceRequested: boolean;
  connectedAccountId: string;
  endsAt: Date;
  inviteCandidate: boolean;
  location: string | null;
  startsAt: Date;
  summary: string;
  timeZone: string;
};

/**
 * Moves a call that Google already holds by patching the event in place, which
 * keeps the event id, the invitation thread, and any candidate RSVP.
 *
 * The load-bearing invariant: the row keeps the schedule Google last confirmed
 * until Google confirms the new one. A row claiming a slot the calendar does
 * not have is worse than a failed action, so the new schedule is written in a
 * single update *after* the patch succeeds, and a failed patch leaves the row
 * on its original — still genuinely booked — slot.
 */
async function rescheduleBookedCall(input: {
  connection: { accessToken: string; accountId: string };
  existingCall: BookedCall;
  organizationId: string;
  providerFactory?: (accessToken: string) => CalendarProvider;
  schedule: CallScheduleData;
  userId: string;
}): Promise<CandidateScheduledCallSummary> {
  const { existingCall, schedule } = input;

  // Resubmitting the booked slot verbatim must not touch Google: an identical
  // patch would still email every guest a pointless "event updated" notice.
  // An in-flight row is excluded — its stored slot is the last one Google
  // confirmed, so it has to be pushed again rather than short-circuited.
  if (
    existingCall.status === "scheduled" &&
    scheduleMatchesExistingCall(existingCall, schedule)
  ) {
    return toScheduledCallSummary(existingCall);
  }

  if (
    existingCall.connectedAccountId &&
    existingCall.connectedAccountId !== input.connection.accountId
  ) {
    throw new CandidateCallSchedulingError(
      "This call lives on another teammate's Google Calendar. Ask them to move it.",
      "not_calendar_owner",
    );
  }

  // A reschedule may move a call and add to it; it may never take away from it.
  // Google documents `sendUpdates` as notifying the guests *of the event*, and
  // documents nothing about a guest removed by the same request, so dropping an
  // attendee here would un-invite someone with no guarantee they are ever told.
  // Same reasoning for a Meet link: clearing `conferenceData` is not a
  // documented patch behaviour. Both removals belong in Google Calendar, which
  // the stored event URL links straight to.
  const removedAttendees = readAttendeeEmails(existingCall.attendeeEmails).filter(
    (email) => !schedule.attendeeEmails.includes(email),
  );
  if (removedAttendees.length > 0) {
    throw new CandidateCallSchedulingError(
      "Removing a guest from a booked call is not supported yet. Move the call here, then remove the guest in Google Calendar.",
      "reschedule_unsupported",
    );
  }
  if (existingCall.conferenceRequested && !schedule.conferenceRequested) {
    throw new CandidateCallSchedulingError(
      "Removing the video link from a booked call is not supported yet. Move the call here, then remove it in Google Calendar.",
      "reschedule_unsupported",
    );
  }

  const keepsConference =
    existingCall.conferenceRequested && schedule.conferenceRequested;

  await prisma.candidateScheduledCall.update({
    data: {
      lastProviderErrorAt: null,
      lastProviderErrorCode: null,
      status: "rescheduling",
    },
    where: { id: existingCall.id },
  });

  const updateEvent = (accessToken: string) =>
    (input.providerFactory ?? createGoogleCalendarProvider)(
      accessToken,
    ).updateEvent({
      attendees: schedule.attendeeEmails,
      calendarId: "primary",
      // `null` leaves the existing conference untouched. A request id is only
      // sent when the reschedule adds conferencing to a call that had none, so
      // reusing the deterministic id stays safe across retries.
      conferenceRequestId: keepsConference
        ? null
        : schedule.conferenceRequested
          ? `prelude-${existingCall.id}`
          : null,
      endsAt: schedule.endsAt,
      eventId: existingCall.providerEventId,
      location: schedule.location,
      startsAt: schedule.startsAt,
      summary: schedule.summary,
      timeZone: schedule.timeZone,
    });

  let event: CalendarEventResult;
  try {
    event = await runCalendarRequest(
      {
        accessToken: input.connection.accessToken,
        accountId: input.connection.accountId,
        organizationId: input.organizationId,
        userId: input.userId,
      },
      updateEvent,
    );
  } catch (error) {
    throw await recordProviderFailure({
      callId: existingCall.id,
      error,
      message:
        "Google Calendar could not move this call. The original time is still booked.",
      // Google still holds the original event at the original time, so the row
      // goes back to claiming exactly that. Marking it `provider_error` would
      // both lie about a booking that is still live and trap the recruiter in
      // the create-retry path, which only accepts an identical resubmission.
      status: "scheduled",
    });
  }

  // A patch response that omits conferenceData must never blank a Meet link
  // Google still hosts.
  const conferenceJoinUrl =
    event.conferenceJoinUrl ??
    (keepsConference ? existingCall.conferenceJoinUrl : null);

  const rescheduled = await prisma.candidateScheduledCall.update({
    data: {
      ...schedule,
      conferenceJoinUrl,
      conferenceStatus: schedule.conferenceRequested
        ? conferenceJoinUrl
          ? "ready"
          : "pending"
        : null,
      lastProviderErrorAt: null,
      lastProviderErrorCode: null,
      providerEventUrl: event.eventUrl ?? existingCall.providerEventUrl,
      status: "scheduled",
    },
    where: { id: existingCall.id },
  });

  return toScheduledCallSummary(rescheduled);
}

async function runCalendarRequest<T>(
  connection: {
    accessToken: string;
    accountId: string;
    organizationId: string;
    userId: string;
  },
  run: (accessToken: string) => Promise<T>,
): Promise<T> {
  try {
    return await run(connection.accessToken);
  } catch (error) {
    if (
      !(error instanceof CalendarProviderError) ||
      !error.isReconnectRequired
    ) {
      throw error;
    }

    const refreshedConnection = await getGoogleCalendarConnection({
      forceRefresh: true,
      organizationId: connection.organizationId,
      userId: connection.userId,
    });
    if (!refreshedConnection.ok) {
      throw new CalendarProviderError(
        "Google Calendar connection could not be refreshed.",
        { code: "reconnect_required", isReconnectRequired: true },
      );
    }

    try {
      return await run(refreshedConnection.accessToken);
    } catch (retryError) {
      if (
        retryError instanceof CalendarProviderError &&
        retryError.isReconnectRequired
      ) {
        await markGoogleCalendarConnectionNeedsReconnect(connection.accountId);
      }
      throw retryError;
    }
  }
}

export function toScheduledCallSummary(call: {
  conferenceJoinUrl: string | null;
  conferenceRequested: boolean;
  conferenceStatus?: string | null;
  attendeeEmails: unknown;
  endsAt: Date;
  inviteCandidate: boolean;
  location: string | null;
  providerEventUrl: string | null;
  startsAt: Date;
  status: string;
  timeZone: string;
}): CandidateScheduledCallSummary {
  const attendeeEmails = readAttendeeEmails(call.attendeeEmails);

  return {
    attendeeEmails,
    conferenceJoinUrl: call.conferenceJoinUrl,
    conferencePending: call.conferenceStatus === "pending",
    conferenceRequested: call.conferenceRequested,
    endsAt: call.endsAt.toISOString(),
    eventUrl: call.providerEventUrl,
    invitationSent: attendeeEmails.length > 0,
    inviteCandidate: call.inviteCandidate,
    location: call.location,
    startsAt: call.startsAt.toISOString(),
    status: call.status === "scheduled" ? "scheduled" : "provider_error",
    timeZone: call.timeZone,
  };
}

function readAttendeeEmails(value: unknown) {
  return Array.isArray(value)
    ? value.filter((email): email is string => typeof email === "string")
    : [];
}

function scheduleMatchesExistingCall(
  existingCall: {
    attendeeEmails: unknown;
    conferenceRequested: boolean;
    endsAt: Date;
    inviteCandidate: boolean;
    location: string | null;
    startsAt: Date;
    timeZone: string;
  },
  schedule: {
    attendeeEmails: string[];
    conferenceRequested: boolean;
    endsAt: Date;
    inviteCandidate: boolean;
    location: string | null;
    startsAt: Date;
    timeZone: string;
  },
) {
  const existingAttendees = readAttendeeEmails(existingCall.attendeeEmails).sort();
  const nextAttendees = [...schedule.attendeeEmails].sort();

  return (
    existingCall.conferenceRequested === schedule.conferenceRequested &&
    existingCall.endsAt.getTime() === schedule.endsAt.getTime() &&
    existingCall.inviteCandidate === schedule.inviteCandidate &&
    existingCall.location === schedule.location &&
    existingCall.startsAt.getTime() === schedule.startsAt.getTime() &&
    existingCall.timeZone === schedule.timeZone &&
    existingAttendees.length === nextAttendees.length &&
    existingAttendees.every((email, index) => email === nextAttendees[index])
  );
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/**
 * What both flows do when Google refuses: stamp what failed on the row, then
 * hand back the refusal the caller throws.
 *
 * `status` is a parameter rather than a constant because the two flows differ
 * there — and that difference is the load-bearing invariant of this file. A
 * failed CREATE leaves `provider_error`: no event exists, and the recruiter
 * retries. A failed RESCHEDULE goes back to `scheduled`: the original booking
 * is still live on the calendar, and claiming otherwise would strand it.
 */
async function recordProviderFailure(input: {
  callId: string;
  error: unknown;
  message: string;
  status: "provider_error" | "scheduled";
}): Promise<CandidateCallSchedulingError> {
  const providerError = toProviderError(input.error);
  await prisma.candidateScheduledCall.update({
    data: {
      lastProviderErrorAt: new Date(),
      lastProviderErrorCode: providerError.code,
      status: input.status,
    },
    where: { id: input.callId },
  });

  return providerError.isReconnectRequired
    ? new CandidateCallSchedulingError(
        "Reconnect Google Calendar before trying again.",
        "reconnect_required",
      )
    : new CandidateCallSchedulingError(input.message, "provider_error");
}

function toProviderError(error: unknown) {
  return error instanceof CalendarProviderError
    ? error
    : new CalendarProviderError("Calendar provider request failed.", {
        code: "provider_error",
      });
}
