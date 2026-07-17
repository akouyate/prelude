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
          attendees: hasAttendees
            ? input.attendees.map((email) => ({ email }))
            : undefined,
          conferenceData: input.conferenceRequestId
            ? {
                createRequest: {
                  requestId: input.conferenceRequestId,
                },
              }
            : undefined,
          description: input.description,
          end: {
            dateTime: input.endsAt.toISOString(),
            timeZone: input.timeZone,
          },
          extendedProperties: {
            private: input.privateExtendedProperties,
          },
          id: input.eventId,
          location: input.location ?? undefined,
          start: {
            dateTime: input.startsAt.toISOString(),
            timeZone: input.timeZone,
          },
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
  };
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
