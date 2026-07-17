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

export type CalendarEventResult = {
  conferenceJoinUrl: string | null;
  eventId: string;
  eventUrl: string | null;
};

export interface CalendarProvider {
  createEvent(input: CreateCalendarEventInput): Promise<CalendarEventResult>;
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
