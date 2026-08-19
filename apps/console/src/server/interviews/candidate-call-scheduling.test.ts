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

import { validateCandidateCallSchedule } from "../../domain/candidate-call-scheduling-policy";
import {
  resolveScheduleCallPrefill,
  toBrowserIsoInstant,
} from "../../features/interview-detail/scheduled-call-presentation";
import {
  scheduleCandidateCall,
  toScheduledCallSummary,
} from "./candidate-call-scheduling";

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

const movedSchedule = {
  ...schedule,
  endsAt: new Date("2030-01-02T15:30:00.000Z"),
  startsAt: new Date("2030-01-02T15:00:00.000Z"),
};

const bookedCall = {
  activeScheduleKey: "session-123",
  attendeeEmails: ["candidate@example.com"],
  conferenceJoinUrl: "https://meet.google.com/abc",
  conferenceRequested: true,
  conferenceStatus: "ready",
  connectedAccountId: "account-123",
  endsAt: schedule.endsAt,
  id: "call-123",
  inviteCandidate: true,
  location: "Paris office",
  providerEventId: "existing-event-id",
  providerEventUrl: "https://calendar.google.com/event?eid=abc",
  startsAt: schedule.startsAt,
  status: "scheduled",
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
          conferenceRequested: schedule.addConference,
          conferenceStatus: data.conferenceStatus ?? null,
          attendeeEmails: data.attendeeEmails ?? schedule.attendeeEmails,
          endsAt: schedule.endsAt,
          inviteCandidate: true,
          location: schedule.location,
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
      providerFactory: () => ({ createEvent, updateEvent: vi.fn() }),
      schedule,
    });

    expect(outcome).toEqual({
      attendeeEmails: ["candidate@example.com"],
      conferenceJoinUrl: "https://meet.google.com/abc",
      conferencePending: false,
      conferenceRequested: true,
      endsAt: "2030-01-01T10:30:00.000Z",
      eventUrl: "https://calendar.google.com/event?eid=abc",
      invitationSent: true,
      inviteCandidate: true,
      location: "Paris office",
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
        providerFactory: () => ({ createEvent, updateEvent: vi.fn() }),
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
      providerFactory: () => ({ createEvent, updateEvent: vi.fn() }),
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
        providerFactory: () => ({ createEvent, updateEvent: vi.fn() }),
        schedule,
      }),
    ).rejects.toMatchObject({ code: "reconnect_required" });

    expect(markGoogleCalendarConnectionNeedsReconnectMock).toHaveBeenCalledWith(
      "account-123",
    );
  });

  it("still reports already_scheduled when two first-time bookings race on the same candidate", async () => {
    prismaMock.candidateScheduledCall.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const createEvent = vi.fn();

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent, updateEvent: vi.fn() }),
        schedule,
      }),
    ).rejects.toMatchObject({ code: "already_scheduled" });

    expect(createEvent).not.toHaveBeenCalled();
  });

  it("returns the booked call untouched when the recruiter resubmits the same slot", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(bookedCall);
    const createEvent = vi.fn();
    const updateEvent = vi.fn();

    const outcome = await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent, updateEvent }),
      schedule,
    });

    expect(createEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
    expect(prismaMock.candidateScheduledCall.update).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      attendeeEmails: ["candidate@example.com"],
      conferenceJoinUrl: "https://meet.google.com/abc",
      conferencePending: false,
      conferenceRequested: true,
      endsAt: "2030-01-01T10:30:00.000Z",
      eventUrl: "https://calendar.google.com/event?eid=abc",
      invitationSent: true,
      inviteCandidate: true,
      location: "Paris office",
      startsAt: "2030-01-01T10:00:00.000Z",
      status: "scheduled",
      timeZone: "Europe/Paris",
    });
  });

  /*
   * The prefill's whole reason for existing, proved end to end: a recruiter
   * opens the dialog on a booked call, changes nothing, submits — and Google
   * is never touched.
   *
   * Every layer the values really pass through is the real one here — the
   * summary the page renders, the prefill the form starts from, the conversion
   * the form submits with, and the policy that parses it. The failure this
   * guards against lives BETWEEN those layers: a field the form forgets reads
   * to this service as a REMOVED guest or a dropped Meet link, which it
   * refuses outright. No single-layer test can see that.
   */
  it("moves nothing when the prefilled dialog is submitted untouched", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValue({
      candidateInvitation: { candidateName: "Ada Martin" },
      // Stored with the capitalisation the candidate typed; the prefill hands
      // it back verbatim and the policy is what normalises it.
      candidateEmail: "Candidate@Example.com",
      candidateName: null,
      id: "session-123",
      interview: { roleTitle: "Customer Success Manager" },
      reviewStatus: "to_call",
    });
    // A guest on top of the candidate, on purpose: dropping either one is a
    // removal, and this service refuses removals rather than un-invite anyone.
    const bookedCallWithGuest = {
      ...bookedCall,
      attendeeEmails: ["candidate@example.com", "hiring@example.com"],
    };
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(
      bookedCallWithGuest,
    );
    const createEvent = vi.fn();
    const updateEvent = vi.fn();

    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "Candidate@Example.com",
      scheduledCall: toScheduledCallSummary(bookedCallWithGuest),
    });
    const parsed = validateCandidateCallSchedule({
      addConference: prefill.addConference ? "on" : "off",
      candidateEmail: prefill.candidateEmail,
      durationMinutes: prefill.durationMinutes,
      guestEmails: prefill.guestEmails,
      inviteCandidate: prefill.inviteCandidate ? "on" : "off",
      location: prefill.location,
      startsAt: toBrowserIsoInstant(prefill.dateTime),
      timeZone: prefill.timeZone,
    });
    if (!parsed.ok) {
      throw new Error(`The prefilled form did not even validate: ${parsed.error}`);
    }

    const outcome = await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent, updateEvent }),
      schedule: parsed.value,
    });

    expect(createEvent).not.toHaveBeenCalled();
    expect(updateEvent).not.toHaveBeenCalled();
    expect(prismaMock.candidateScheduledCall.update).not.toHaveBeenCalled();
    expect(outcome.startsAt).toBe("2030-01-01T10:00:00.000Z");
  });

  it("patches the existing Google event and only then records the new slot", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(bookedCall);
    const updateEvent = vi.fn().mockResolvedValue({
      conferenceJoinUrl: "https://meet.google.com/abc",
      eventId: "existing-event-id",
      eventUrl: "https://calendar.google.com/event?eid=abc",
    });

    const outcome = await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
      schedule: movedSchedule,
    });

    expect(prismaMock.candidateScheduledCall.create).not.toHaveBeenCalled();
    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        attendees: ["candidate@example.com"],
        calendarId: "primary",
        conferenceRequestId: null,
        endsAt: movedSchedule.endsAt,
        eventId: "existing-event-id",
        startsAt: movedSchedule.startsAt,
      }),
    );

    const updates = prismaMock.candidateScheduledCall.update.mock.calls;
    expect(updates).toHaveLength(2);
    const inFlight = updates.at(0)?.[0];
    const settled = updates.at(1)?.[0];
    expect(inFlight?.data).toEqual({
      lastProviderErrorAt: null,
      lastProviderErrorCode: null,
      status: "rescheduling",
    });
    expect(inFlight?.data).not.toHaveProperty("startsAt");
    expect(settled?.data).toMatchObject({
      startsAt: movedSchedule.startsAt,
      status: "scheduled",
    });
    expect(outcome.startsAt).toBe("2030-01-02T15:00:00.000Z");
  });

  it("keeps the stored slot when Google refuses to move the event", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(bookedCall);
    const updateEvent = vi
      .fn()
      .mockRejectedValue(
        new CalendarProviderError("Backend error", { code: "500" }),
      );

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
        schedule: movedSchedule,
      }),
    ).rejects.toMatchObject({ code: "provider_error" });

    // Google still holds the original slot, so the row must still claim it.
    for (const call of prismaMock.candidateScheduledCall.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty("startsAt");
    }
    const settled = prismaMock.candidateScheduledCall.update.mock.calls.at(
      -1,
    )?.[0];
    expect(settled?.data).toMatchObject({
      lastProviderErrorCode: "500",
      status: "scheduled",
    });
  });

  it("keeps the Meet link when Google's patch response omits the conference", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(bookedCall);
    const updateEvent = vi.fn().mockResolvedValue({
      conferenceJoinUrl: null,
      eventId: "existing-event-id",
      eventUrl: null,
    });

    const outcome = await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
      schedule: movedSchedule,
    });

    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ conferenceRequestId: null }),
    );
    expect(outcome.conferenceJoinUrl).toBe("https://meet.google.com/abc");
    expect(outcome.conferencePending).toBe(false);
    expect(outcome.eventUrl).toBe("https://calendar.google.com/event?eid=abc");
  });

  it("asks Google for a Meet link when the reschedule adds conferencing", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue({
      ...bookedCall,
      conferenceJoinUrl: null,
      conferenceRequested: false,
      conferenceStatus: null,
    });
    const updateEvent = vi.fn().mockResolvedValue({
      conferenceJoinUrl: null,
      eventId: "existing-event-id",
      eventUrl: null,
    });

    const outcome = await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
      schedule: movedSchedule,
    });

    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ conferenceRequestId: "prelude-call-123" }),
    );
    expect(outcome.conferencePending).toBe(true);
  });

  it("refuses to drop a guest from a booked call rather than silently un-inviting them", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue({
      ...bookedCall,
      attendeeEmails: ["candidate@example.com", "hiring@example.com"],
    });
    const updateEvent = vi.fn();

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
        schedule: movedSchedule,
      }),
    ).rejects.toMatchObject({ code: "reschedule_unsupported" });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(prismaMock.candidateScheduledCall.update).not.toHaveBeenCalled();
  });

  it("refuses to drop the video link from a booked call", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(bookedCall);
    const updateEvent = vi.fn();

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
        schedule: { ...movedSchedule, addConference: false },
      }),
    ).rejects.toMatchObject({ code: "reschedule_unsupported" });

    expect(updateEvent).not.toHaveBeenCalled();
    expect(prismaMock.candidateScheduledCall.update).not.toHaveBeenCalled();
  });

  it("refuses to move a call that lives on another recruiter's calendar", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue({
      ...bookedCall,
      connectedAccountId: "account-999",
    });
    const updateEvent = vi.fn();

    await expect(
      scheduleCandidateCall({
        actorRole: "recruiter",
        actorUserId: "user-123",
        candidateSessionId: "session-123",
        organizationId: "org-123",
        providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
        schedule: movedSchedule,
      }),
    ).rejects.toMatchObject({ code: "not_calendar_owner" });

    expect(updateEvent).not.toHaveBeenCalled();
  });

  it("patches again when a crashed reschedule left the row in flight", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue({
      ...bookedCall,
      status: "rescheduling",
    });
    const updateEvent = vi.fn().mockResolvedValue({
      conferenceJoinUrl: "https://meet.google.com/abc",
      eventId: "existing-event-id",
      eventUrl: "https://calendar.google.com/event?eid=abc",
    });

    await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
      schedule,
    });

    // The stored slot is the last one Google confirmed; an in-flight row must
    // converge on it instead of short-circuiting as an identical resubmission.
    expect(updateEvent).toHaveBeenCalledTimes(1);
  });

  it("refreshes once after an expired Calendar access token during a reschedule", async () => {
    prismaMock.candidateScheduledCall.findFirst.mockResolvedValue(bookedCall);
    const updateEvent = vi
      .fn()
      .mockRejectedValueOnce(
        new CalendarProviderError("Unauthorized", {
          code: "401",
          isReconnectRequired: true,
        }),
      )
      .mockResolvedValueOnce({
        conferenceJoinUrl: "https://meet.google.com/abc",
        eventId: "existing-event-id",
        eventUrl: "https://calendar.google.com/event?eid=abc",
      });

    await scheduleCandidateCall({
      actorRole: "recruiter",
      actorUserId: "user-123",
      candidateSessionId: "session-123",
      organizationId: "org-123",
      providerFactory: () => ({ createEvent: vi.fn(), updateEvent }),
      schedule: movedSchedule,
    });

    expect(getGoogleCalendarConnectionMock).toHaveBeenLastCalledWith({
      forceRefresh: true,
      organizationId: "org-123",
      userId: "user-123",
    });
    expect(updateEvent).toHaveBeenCalledTimes(2);
  });
});
