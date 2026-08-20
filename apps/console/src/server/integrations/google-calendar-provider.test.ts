import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGoogleCalendarProvider } from "./google-calendar-provider";

describe("Google Calendar provider", () => {
  it("creates a private logistics-only event and sends updates only to explicit attendees", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          conferenceData: {
            entryPoints: [
              { entryPointType: "video", uri: "https://meet.google.com/abc" },
            ],
          },
          htmlLink: "https://calendar.google.com/event?eid=abc",
          id: "event-123",
        }),
        { status: 200 },
      ),
    );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);
    const startsAt = new Date("2030-01-01T10:00:00.000Z");

    const event = await provider.createEvent({
      attendees: ["candidate@example.com"],
      calendarId: "primary",
      conferenceRequestId: "prelude-call-123",
      description: "",
      endsAt: new Date("2030-01-01T10:30:00.000Z"),
      eventId: "event123",
      location: "Paris office",
      privateExtendedProperties: { preludeCandidateSessionId: "session-123" },
      startsAt,
      summary: "Follow-up call · Candidate · Product Designer",
      timeZone: "Europe/Paris",
    });

    expect(event).toEqual({
      conferenceJoinUrl: "https://meet.google.com/abc",
      eventId: "event-123",
      eventUrl: "https://calendar.google.com/event?eid=abc",
    });
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer token-123",
    });
    expect(JSON.parse(String(options.body))).toEqual(
      expect.objectContaining({
        attendees: [{ email: "candidate@example.com" }],
        description: "",
        extendedProperties: {
          private: { preludeCandidateSessionId: "session-123" },
        },
      }),
    );
  });

  it("does not send a calendar update when no attendee is supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "event-123" }), { status: 200 }),
      );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await provider.createEvent({
      attendees: [],
      calendarId: "primary",
      conferenceRequestId: null,
      description: "",
      endsAt: new Date("2030-01-01T10:30:00.000Z"),
      eventId: "event123",
      location: null,
      privateExtendedProperties: {},
      startsAt: new Date("2030-01-01T10:00:00.000Z"),
      summary: "Follow-up call",
      timeZone: "Europe/Paris",
    });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(String(options.body))).not.toHaveProperty("attendees");
  });

  it("reconciles an event when Google reports that the idempotency event id already exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 409 } }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            htmlLink: "https://calendar.google.com/event?eid=existing",
            id: "event123",
          }),
          { status: 200 },
        ),
      );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await expect(
      provider.createEvent({
        attendees: [],
        calendarId: "primary",
        conferenceRequestId: null,
        description: "",
        endsAt: new Date("2030-01-01T10:30:00.000Z"),
        eventId: "event123",
        location: null,
        privateExtendedProperties: {},
        startsAt: new Date("2030-01-01T10:00:00.000Z"),
        summary: "Follow-up call",
        timeZone: "Europe/Paris",
      }),
    ).resolves.toEqual({
      conferenceJoinUrl: null,
      eventId: "event123",
      eventUrl: "https://calendar.google.com/event?eid=existing",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/events/event123");
  });

  it("patches the existing event in place so the invitation thread survives a reschedule", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          htmlLink: "https://calendar.google.com/event?eid=abc",
          id: "event123",
        }),
        { status: 200 },
      ),
    );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await provider.updateEvent({
      attendees: ["candidate@example.com"],
      calendarId: "primary",
      conferenceRequestId: null,
      endsAt: new Date("2030-01-02T15:45:00.000Z"),
      eventId: "event123",
      location: "Lyon office",
      startsAt: new Date("2030-01-02T15:00:00.000Z"),
      summary: "Follow-up call · Ada Martin · Customer Success Manager",
      timeZone: "Europe/Paris",
    });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(options.method).toBe("PATCH");
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events/event123");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer token-123",
    });
    expect(JSON.parse(String(options.body))).toEqual({
      attendees: [{ email: "candidate@example.com" }],
      end: {
        dateTime: "2030-01-02T15:45:00.000Z",
        timeZone: "Europe/Paris",
      },
      location: "Lyon office",
      start: {
        dateTime: "2030-01-02T15:00:00.000Z",
        timeZone: "Europe/Paris",
      },
      summary: "Follow-up call · Ada Martin · Customer Success Manager",
    });
  });

  it("re-notifies every guest when a reschedule moves a call that has attendees", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "event123" }), { status: 200 }),
      );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await provider.updateEvent({
      attendees: ["candidate@example.com", "hiring@example.com"],
      calendarId: "primary",
      conferenceRequestId: null,
      endsAt: new Date("2030-01-02T15:45:00.000Z"),
      eventId: "event123",
      location: null,
      startsAt: new Date("2030-01-02T15:00:00.000Z"),
      summary: "Follow-up call",
      timeZone: "Europe/Paris",
    });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("sendUpdates")).toBe("all");
  });

  it("sends no calendar update when a private reschedule has no attendee", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "event123" }), { status: 200 }),
      );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await provider.updateEvent({
      attendees: [],
      calendarId: "primary",
      conferenceRequestId: null,
      endsAt: new Date("2030-01-02T15:45:00.000Z"),
      eventId: "event123",
      location: null,
      startsAt: new Date("2030-01-02T15:00:00.000Z"),
      summary: "Follow-up call",
      timeZone: "Europe/Paris",
    });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(String(options.body))).not.toHaveProperty("attendees");
  });

  it("keeps an existing Meet link by declaring conference support and never sending conferenceData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          conferenceData: {
            entryPoints: [
              { entryPointType: "video", uri: "https://meet.google.com/abc" },
            ],
          },
          id: "event123",
        }),
        { status: 200 },
      ),
    );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    const event = await provider.updateEvent({
      attendees: ["candidate@example.com"],
      calendarId: "primary",
      conferenceRequestId: null,
      endsAt: new Date("2030-01-02T15:45:00.000Z"),
      eventId: "event123",
      location: null,
      startsAt: new Date("2030-01-02T15:00:00.000Z"),
      summary: "Follow-up call",
      timeZone: "Europe/Paris",
    });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    // conferenceDataVersion=0 tells Google the client has no conference
    // support, so the Meet link would drop out of the patch response and we
    // would persist a null join URL. Patch semantics keep the conference as
    // long as the body carries no `conferenceData` key at all.
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(JSON.parse(String(options.body))).not.toHaveProperty(
      "conferenceData",
    );
    expect(event.conferenceJoinUrl).toBe("https://meet.google.com/abc");
  });

  it("asks for a new conference only when the reschedule adds one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          conferenceData: {
            createRequest: { status: { statusCode: "pending" } },
          },
          id: "event123",
        }),
        { status: 200 },
      ),
    );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await provider.updateEvent({
      attendees: [],
      calendarId: "primary",
      conferenceRequestId: "prelude-call-123",
      endsAt: new Date("2030-01-02T15:45:00.000Z"),
      eventId: "event123",
      location: null,
      startsAt: new Date("2030-01-02T15:00:00.000Z"),
      summary: "Follow-up call",
      timeZone: "Europe/Paris",
    });

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(JSON.parse(String(options.body))).toMatchObject({
      conferenceData: { createRequest: { requestId: "prelude-call-123" } },
    });
  });

  it("clears a location the recruiter emptied instead of leaving the stale one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "event123" }), { status: 200 }),
      );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await provider.updateEvent({
      attendees: [],
      calendarId: "primary",
      conferenceRequestId: null,
      endsAt: new Date("2030-01-02T15:45:00.000Z"),
      eventId: "event123",
      location: null,
      startsAt: new Date("2030-01-02T15:00:00.000Z"),
      summary: "Follow-up call",
      timeZone: "Europe/Paris",
    });

    const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({ location: "" });
  });

  it("surfaces a reconnect-required provider error when Google rejects the patch as unauthenticated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { status: "UNAUTHENTICATED" } }),
          { status: 401 },
        ),
      );
    const provider = createGoogleCalendarProvider("token-123", fetchMock);

    await expect(
      provider.updateEvent({
        attendees: [],
        calendarId: "primary",
        conferenceRequestId: null,
        endsAt: new Date("2030-01-02T15:45:00.000Z"),
        eventId: "event123",
        location: null,
        startsAt: new Date("2030-01-02T15:00:00.000Z"),
        summary: "Follow-up call",
        timeZone: "Europe/Paris",
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      isReconnectRequired: true,
      name: "CalendarProviderError",
    });
  });
});
