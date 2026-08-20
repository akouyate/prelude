import "server-only";

export type CreateCalendarEventInput = {
  attendees: string[];
  calendarId: string;
  conferenceRequestId: string | null;
  description: string;
  endsAt: Date;
  eventId: string;
  location: string | null;
  privateExtendedProperties: Record<string, string>;
  startsAt: Date;
  summary: string;
  timeZone: string;
};

/**
 * A reschedule patches the event that already exists, so it only carries the
 * fields a recruiter can move. Anything omitted here — the description and the
 * private HireCall session reference — is left untouched by Google's patch
 * semantics, which is exactly what a reschedule wants.
 *
 * `conferenceRequestId` reads differently from the create input: `null` means
 * "leave whatever conference the event already has alone" rather than "no
 * conference", because a patch that never mentions `conferenceData` cannot
 * drop an existing Google Meet link.
 */
export type UpdateCalendarEventInput = {
  attendees: string[];
  calendarId: string;
  conferenceRequestId: string | null;
  endsAt: Date;
  eventId: string;
  location: string | null;
  startsAt: Date;
  summary: string;
  timeZone: string;
};

export type CalendarEventResult = {
  conferenceJoinUrl: string | null;
  eventId: string;
  eventUrl: string | null;
};

export interface CalendarProvider {
  createEvent(input: CreateCalendarEventInput): Promise<CalendarEventResult>;
  updateEvent(input: UpdateCalendarEventInput): Promise<CalendarEventResult>;
}

export class CalendarProviderError extends Error {
  readonly code: string;
  readonly isReconnectRequired: boolean;

  constructor(
    message: string,
    input: { code: string; isReconnectRequired?: boolean },
  ) {
    super(message);
    this.name = "CalendarProviderError";
    this.code = input.code;
    this.isReconnectRequired = input.isReconnectRequired ?? false;
  }
}
