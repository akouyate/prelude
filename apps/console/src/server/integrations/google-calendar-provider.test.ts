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
});
