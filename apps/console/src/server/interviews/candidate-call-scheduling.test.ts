import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarProviderError } from "../integrations/calendar-provider";

const prismaMock = vi.hoisted(() => ({
  candidateScheduledCall: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  candidateSession: {
    findFirst: vi.fn(),
  },
}));
const getGoogleCalendarConnectionMock = vi.hoisted(() => vi.fn());
const markGoogleCalendarConnectionNeedsReconnectMock = vi.hoisted(() =>
  vi.fn(),
);

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("server-only", () => ({}));
vi.mock("../integrations/connected-account-service", () => ({
  getGoogleCalendarConnection: getGoogleCalendarConnectionMock,
  markGoogleCalendarConnectionNeedsReconnect:
    markGoogleCalendarConnectionNeedsReconnectMock,
}));

import { scheduleCandidateCall } from "./candidate-call-scheduling";

const schedule = {
  addConference: true,
  attendeeEmails: ["candidate@example.com"],
  candidateEmail: "candidate@example.com",
  endsAt: new Date("2030-01-01T10:30:00.000Z"),
  inviteCandidate: true,
  location: "Paris office",
  startsAt: new Date("2030-01-01T10:00:00.000Z"),
  timeZone: "Europe/Paris",
};

describe("candidate call scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleCalendarConnectionMock.mockResolvedValue({
      accessToken: "encrypted-token",
      accountId: "account-123",
      accountLabel: "recruiter@example.com",
      ok: true,
    });
    prismaMock.candidateSession.findFirst.mockResolvedValue({
      candidateInvitation: { candidateName: "Ada Martin" },
      candidateName: null,
      id: "session-123",
      interview: { roleTitle: "Customer Success Manager" },
      reviewStatus: "to_call",
    });
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(null);
    prismaMock.candidateScheduledCall.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data }),
    );
    prismaMock.candidateScheduledCall.update.mockImplementation(
      ({ data, where }) =>
        Promise.resolve({
          conferenceJoinUrl: data.conferenceJoinUrl ?? null,
          conferenceStatus: data.conferenceStatus ?? null,
          attendeeEmails: data.attendeeEmails ?? schedule.attendeeEmails,
          inviteCandidate: true,
          providerEventUrl: data.providerEventUrl ?? null,
          startsAt: schedule.startsAt,
          status: data.status,
          timeZone: schedule.timeZone,
          ...data,
          id: where.id,
        }),
    );
  });

  it("creates a calendar event for a To call candidate without leaking private review data", async () => {
    const createEvent = vi.fn().mockResolvedValue({
      conferenceJoinUrl: "https://meet.google.com/abc",
      conferencePending: false,
      eventId: "google-event-123",
      eventUrl: "https://calendar.google.com/event?eid=abc",
    });

    const outcome = await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent }),
      schedule,
    });

    expect(outcome).toEqual({
      conferenceJoinUrl: "https://meet.google.com/abc",
      conferencePending: false,
      eventUrl: "https://calendar.google.com/event?eid=abc",
      invitationSent: true,
      startsAt: "2030-01-01T10:00:00.000Z",
      status: "scheduled",
      timeZone: "Europe/Paris",
    });
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        attendees: ["candidate@example.com"],
        description: "",
        privateExtendedProperties: { preludeCandidateSessionId: "session-123" },
        summary: "Follow-up call · Ada Martin · Customer Success Manager",
      }),
    );
    expect(prismaMock.candidateScheduledCall.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activeScheduleKey: "session-123",
        connectedAccountId: "account-123",
        inviteCandidate: true,
      }),
    });
  });

  it("rejects scheduling unless the recruiter explicitly moved the candidate to To call", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValue({
      candidateInvitation: null,
      candidateName: "Ada Martin",
      id: "session-123",
      interview: { roleTitle: "Customer Success Manager" },
      reviewStatus: "to_review",
    });

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        schedule,
      }),
    ).rejects.toMatchObject({
      code: "not_ready",
    });

    expect(prismaMock.candidateScheduledCall.create).not.toHaveBeenCalled();
  });

  it("does not create a call when the recruiter's Google Calendar is disconnected", async () => {
    getGoogleCalendarConnectionMock.mockResolvedValue({
      ok: false,
      status: "not_connected",
    });

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        schedule,
      }),
    ).rejects.toMatchObject({
      code: "not_connected",
    });

    expect(prismaMock.candidateScheduledCall.create).not.toHaveBeenCalled();
  });

  it("uses the persisted candidate email to prevent a forged guest-only invitation", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValue({
      candidateEmail: "candidate@example.com",
      candidateInvitation: { candidateName: "Ada Martin" },
      candidateName: null,
      id: "session-123",
      interview: { roleTitle: "Customer Success Manager" },
      reviewStatus: "to_call",
    });

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        schedule: {
          ...schedule,
          attendeeEmails: ["candidate@example.com"],
          candidateEmail: "different@example.com",
          inviteCandidate: false,
        },
      }),
    ).rejects.toMatchObject({ code: "not_ready" });

    expect(prismaMock.candidateScheduledCall.create).not.toHaveBeenCalled();
  });

  it("does not change event details while retrying a previously failed provider request", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue({
      activeScheduleKey: "session-123",
      attendeeEmails: ["candidate@example.com"],
      conferenceRequested: true,
      endsAt: schedule.endsAt,
      id: "call-123",
      inviteCandidate: true,
      location: "Paris office",
      providerEventId: "existing-event-id",
      startsAt: schedule.startsAt,
      status: "provider_error",
      timeZone: "Europe/Paris",
    });
    const createEvent = vi.fn();

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent }),
        schedule: { ...schedule, addConference: false },
      }),
    ).rejects.toMatchObject({ code: "provider_error" });

    expect(createEvent).not.toHaveBeenCalled();
    expect(prismaMock.candidateScheduledCall.update).not.toHaveBeenCalled();
  });

  it("refreshes once after an expired Calendar access token", async () => {
    const createEvent = vi
      .fn()
      .mockRejectedValueOnce(
        new CalendarProviderError("Unauthorized", {
          code: "401",
          isReconnectRequired: true,
        }),
      )
      .mockResolvedValueOnce({
        conferenceJoinUrl: null,
        eventId: "google-event-123",
        eventUrl: "https://calendar.google.com/event?eid=abc",
      });
    getGoogleCalendarConnectionMock
      .mockResolvedValueOnce({
        accessToken: "old-token",
        accountId: "account-123",
        accountLabel: "recruiter@example.com",
        ok: true,
      })
      .mockResolvedValueOnce({
        accessToken: "refreshed-token",
        accountId: "account-123",
        accountLabel: "recruiter@example.com",
        ok: true,
      });

    await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent }),
      schedule,
    });

    expect(getGoogleCalendarConnectionMock).toHaveBeenLastCalledWith({
      forceRefresh: true,
      organizationId: "org-123",
      userId: "user-123",
    });
    expect(createEvent).toHaveBeenCalledTimes(2);
  });

  it("marks the connection for reconnect when refresh and retry both fail", async () => {
    const createEvent = vi
      .fn()
      .mockRejectedValue(
        new CalendarProviderError("Unauthorized", {
          code: "401",
          isReconnectRequired: true,
        }),
      );

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent }),
        schedule,
      }),
    ).rejects.toMatchObject({ code: "reconnect_required" });

    expect(markGoogleCalendarConnectionNeedsReconnectMock).toHaveBeenCalledWith(
      "account-123",
    );
  });
});
