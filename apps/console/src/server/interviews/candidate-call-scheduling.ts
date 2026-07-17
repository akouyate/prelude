import "server-only";

import { randomUUID } from "node:crypto";

import { prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { canManageCandidateReview } from "../../domain/candidate-review-policy";
import type { ValidatedCandidateCallSchedule } from "../../domain/candidate-call-scheduling-policy";
import {
  CalendarProviderError,
  type CalendarProvider,
} from "../integrations/calendar-provider";
import {
  getGoogleCalendarConnection,
  markGoogleCalendarConnectionNeedsReconnect,
} from "../integrations/connected-account-service";
import { createGoogleCalendarProvider } from "../integrations/google-calendar-provider";

export type CandidateScheduledCallSummary = {
  conferenceJoinUrl: string | null;
  conferencePending: boolean;
  eventUrl: string | null;
  invitationSent: boolean;
  startsAt: string;
  status: "provider_error" | "scheduled";
  timeZone: string;
};

export class CandidateCallSchedulingError extends Error {
  readonly code:
    | "already_scheduled"
    | "not_connected"
    | "not_ready"
    | "provider_error"
    | "reconnect_required"
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
      "The invitation must use the candidate email saved in Prelude.",
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
  if (existingCall?.status === "scheduled") {
    throw new CandidateCallSchedulingError(
      "A next call is already scheduled for this candidate.",
      "already_scheduled",
    );
  }

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
    let event;
    try {
      event = await createEvent(connection.accessToken);
    } catch (error) {
      if (
        !(error instanceof CalendarProviderError) ||
        !error.isReconnectRequired
      ) {
        throw error;
      }

      const refreshedConnection = await getGoogleCalendarConnection({
        forceRefresh: true,
        organizationId: input.organizationId,
        userId: input.actorUserId,
      });
      if (!refreshedConnection.ok) {
        throw new CalendarProviderError(
          "Google Calendar connection could not be refreshed.",
          { code: "reconnect_required", isReconnectRequired: true },
        );
      }

      try {
        event = await createEvent(refreshedConnection.accessToken);
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
    const providerError = toProviderError(error);
    await prisma.candidateScheduledCall.update({
      data: {
        lastProviderErrorAt: new Date(),
        lastProviderErrorCode: providerError.code,
        status: "provider_error",
      },
      where: { id: call.id },
    });

    if (providerError.isReconnectRequired) {
      throw new CandidateCallSchedulingError(
        "Reconnect Google Calendar before trying again.",
        "reconnect_required",
      );
    }

    throw new CandidateCallSchedulingError(
      "Google Calendar could not schedule this call. Please try again.",
      "provider_error",
    );
  }
}

export function toScheduledCallSummary(call: {
  conferenceJoinUrl: string | null;
  conferenceStatus?: string | null;
  attendeeEmails: unknown;
  providerEventUrl: string | null;
  startsAt: Date;
  status: string;
  timeZone: string;
}): CandidateScheduledCallSummary {
  return {
    conferenceJoinUrl: call.conferenceJoinUrl,
    conferencePending: call.conferenceStatus === "pending",
    eventUrl: call.providerEventUrl,
    invitationSent: readAttendeeEmails(call.attendeeEmails).length > 0,
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

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
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

function toProviderError(error: unknown) {
  return error instanceof CalendarProviderError
    ? error
    : new CalendarProviderError("Calendar provider request failed.", {
        code: "provider_error",
      });
}
