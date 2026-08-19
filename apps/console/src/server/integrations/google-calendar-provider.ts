import "server-only";

import {
  CalendarProviderError,
  type CalendarEventResult,
  type CalendarProvider,
  type CreateCalendarEventInput,
} from "./calendar-provider";

const calendarApiBaseUrl = "https://www.googleapis.com/calendar/v3";

type FetchLike = typeof fetch;

export function createGoogleCalendarProvider(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): CalendarProvider {
  return {
    async createEvent(input) {
      const url = new URL(
        `${calendarApiBaseUrl}/calendars/${encodeURIComponent(input.calendarId)}/events`,
      );
      const hasAttendees = input.attendees.length > 0;
      // Google documents that `sendUpdates=all` notifies attendees; a private
      // recruiter event must send no updates. See docs/sources/google-calendar-scheduling.md.
      url.searchParams.set("sendUpdates", hasAttendees ? "all" : "none");
      if (input.conferenceRequestId) {
        // conferenceDataVersion=1 enables a Google Meet createRequest.
        url.searchParams.set("conferenceDataVersion", "1");
      }

      const response = await fetchImpl(url, {
        body: JSON.stringify({
          attendees: toAttendees(input.attendees),
          conferenceData: toConferenceData(input.conferenceRequestId),
          description: input.description,
          end: toTimeField(input.endsAt, input.timeZone),
          extendedProperties: {
            private: input.privateExtendedProperties,
          },
          id: input.eventId,
          location: input.location ?? undefined,
          start: toTimeField(input.startsAt, input.timeZone),
          summary: input.summary,
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        if (response.status === 409) {
          const existing = await getExistingEvent({
            accessToken,
            calendarId: input.calendarId,
            eventId: input.eventId,
            fetchImpl,
          });
          if (existing) {
            return existing;
          }
        }
        throw providerError("Google Calendar event creation failed.", payload);
      }

      return readCalendarEvent(payload);
    },

    async updateEvent(input) {
      const url = new URL(
        `${calendarApiBaseUrl}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      );
      const hasAttendees = input.attendees.length > 0;
      // A moved meeting nobody was told about is worse than no meeting, so a
      // reschedule re-notifies on exactly the same rule as a creation.
      url.searchParams.set("sendUpdates", hasAttendees ? "all" : "none");
      // Always version 1, even when we are not asking for a conference.
      // Google documents version 0 as "assumes no conference data support and
      // ignores conference data in the event's body": a version-0 client is
      // not conference-aware, so the Meet link drops out of the patch response
      // and we would persist a null join URL for an event that still has one.
      // Version 1 is safe here because the request body below never carries a
      // `conferenceData` key unless a new conference was asked for, and patch
      // semantics leave an omitted field untouched. See
      // docs/sources/google-calendar-scheduling.md.
      url.searchParams.set("conferenceDataVersion", "1");

      const response = await fetchImpl(url, {
        body: JSON.stringify({
          // Omitting `attendees` keeps the current guest list. Sending a
          // shorter list would replace it wholesale, and Google only documents
          // `sendUpdates` as notifying guests of the event — not guests it just
          // removed. Callers must not shrink this list; see
          // candidate-call-scheduling.ts.
          attendees: toAttendees(input.attendees),
          conferenceData: toConferenceData(input.conferenceRequestId),
          end: toTimeField(input.endsAt, input.timeZone),
          // An empty string clears a location the recruiter emptied; omitting
          // the key would leave the stale one behind.
          location: input.location ?? "",
          start: toTimeField(input.startsAt, input.timeZone),
          summary: input.summary,
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "PATCH",
      });
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        throw providerError("Google Calendar event update failed.", payload);
      }

      return readCalendarEvent(payload);
    },
  };
}

/*
 * The three parts a create and a patch build identically. Everything they do
 * NOT share — the method, the headers, `description`/`id`/`extendedProperties`,
 * how each treats an emptied `location`, and when `conferenceDataVersion` is
 * sent — stays written out at each call site, because those differences are
 * deliberate and documented there.
 */

/** `undefined` omits the key, which leaves an existing guest list untouched. */
function toAttendees(attendees: string[]) {
  return attendees.length > 0
    ? attendees.map((email) => ({ email }))
    : undefined;
}

/** Only ever asks for a NEW conference; `null` omits the key entirely. */
function toConferenceData(conferenceRequestId: string | null) {
  return conferenceRequestId
    ? { createRequest: { requestId: conferenceRequestId } }
    : undefined;
}

/**
 * Google reads `dateTime` as the instant and `timeZone` as the zone the event
 * is *held* in — which is why the zone travels with both ends rather than
 * being inferred from the offset.
 */
function toTimeField(instant: Date, timeZone: string) {
  return { dateTime: instant.toISOString(), timeZone };
}

async function getExistingEvent({
  accessToken,
  calendarId,
  eventId,
  fetchImpl,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  fetchImpl: FetchLike;
}) {
  const response = await fetchImpl(
    `${calendarApiBaseUrl}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    return null;
  }

  return readCalendarEvent(await readJsonResponse(response));
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { response: "non_json" };
  }
}

function readCalendarEvent(
  payload: Record<string, unknown>,
): CalendarEventResult {
  if (typeof payload.id !== "string") {
    throw new CalendarProviderError(
      "Google Calendar event response did not include an event id.",
      { code: "invalid_event_response" },
    );
  }

  return {
    conferenceJoinUrl: readConferenceJoinUrl(payload),
    eventId: payload.id,
    eventUrl: typeof payload.htmlLink === "string" ? payload.htmlLink : null,
  };
}

function readConferenceJoinUrl(payload: Record<string, unknown>) {
  const conferenceData = payload.conferenceData;
  if (!isRecord(conferenceData) || !Array.isArray(conferenceData.entryPoints)) {
    return null;
  }

  const videoEntry = conferenceData.entryPoints.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.entryPointType === "video",
  );

  return videoEntry && typeof videoEntry.uri === "string"
    ? videoEntry.uri
    : null;
}

function providerError(message: string, payload: Record<string, unknown>) {
  const error = isRecord(payload.error) ? payload.error : payload;
  const code =
    typeof error.status === "string"
      ? error.status
      : typeof error.code === "number"
        ? String(error.code)
        : "provider_error";

  return new CalendarProviderError(message, {
    code,
    isReconnectRequired: code === "401" || code === "UNAUTHENTICATED",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
