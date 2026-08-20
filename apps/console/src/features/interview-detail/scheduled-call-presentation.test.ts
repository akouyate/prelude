import { describe, expect, it } from "vitest";

import {
  formatCompactCallLabel,
  formatScheduledDate,
  resolveScheduleCallPrefill,
  resolveScheduleTrigger,
  resolveScheduledCallBanner,
  scheduledCallBannerId,
  toBrowserIsoInstant,
  type ScheduledCallSummary,
} from "./scheduled-call-presentation";

function scheduledCall(
  overrides: Partial<ScheduledCallSummary> = {},
): ScheduledCallSummary {
  return {
    attendeeEmails: ["ada@example.com"],
    conferenceJoinUrl: "https://meet.google.com/abc-defg-hij",
    conferencePending: false,
    conferenceRequested: true,
    endsAt: "2026-08-29T16:10:00.000Z",
    eventUrl: "https://calendar.google.com/event?eid=abc",
    inviteCandidate: true,
    invitationSent: true,
    location: "Paris office",
    startsAt: "2026-08-29T15:40:00.000Z",
    status: "scheduled",
    timeZone: "Europe/Paris",
    ...overrides,
  };
}

// The banner is the page's answer to "what happens next with this candidate".
// It states a fact, so it only appears when there IS a fact: a call the
// provider confirmed, at a moment we can actually place in time.
describe("resolveScheduledCallBanner", () => {
  it("announces nothing when no call has been booked", () => {
    expect(resolveScheduledCallBanner(null)).toBeNull();
  });

  it("announces nothing while a provider error is still awaiting a retry", () => {
    // `provider_error` means Google never confirmed the event. Saying "next
    // call scheduled" over it would promise a meeting nobody was invited to,
    // and the recruiter still has the plain call-to-action to retry with.
    expect(
      resolveScheduledCallBanner(scheduledCall({ status: "provider_error" })),
    ).toBeNull();
  });

  it("announces nothing when the stored start time cannot be read", () => {
    expect(
      resolveScheduledCallBanner(scheduledCall({ startsAt: "not-a-date" })),
    ).toBeNull();
  });

  it("says the invitation went out when the candidate was invited", () => {
    expect(
      resolveScheduledCallBanner(scheduledCall(), { canReschedule: true }),
    ).toEqual({
      call: scheduledCall(),
      invitationMessageKey: "schedule.nextCallInvitationSent",
      showActions: true,
    });
  });

  it("says the event stayed private when no invitation was sent", () => {
    const call = scheduledCall({ invitationSent: false });

    expect(resolveScheduledCallBanner(call)?.invitationMessageKey).toBe(
      "schedule.nextCallPrivateEvent",
    );
  });

  it("reports no action row when there is neither a link nor a move to offer", () => {
    const call = scheduledCall({ conferenceJoinUrl: null, eventUrl: null });

    expect(resolveScheduledCallBanner(call)?.showActions).toBe(false);
  });

  it("keeps the action row for a private event the reader may still move", () => {
    // A call with no Calendar or Meet URL has nowhere to send the recruiter,
    // but "Reschedule" is still a real thing to do with it — the row must not
    // disappear along with the links.
    const call = scheduledCall({ conferenceJoinUrl: null, eventUrl: null });

    expect(
      resolveScheduledCallBanner(call, { canReschedule: true })?.showActions,
    ).toBe(true);
  });

  it("drops the action row for a reader who can neither open nor move the call", () => {
    // Viewers read the banner too. A private event gives them nothing to open,
    // and offering them a move the server would refuse with `unauthorized` is
    // a promise the product cannot keep — so there is no row left to draw.
    const call = scheduledCall({ conferenceJoinUrl: null, eventUrl: null });

    expect(
      resolveScheduledCallBanner(call, { canReschedule: false })?.showActions,
    ).toBe(false);
    // The same viewer still gets the row when there is a link on it.
    expect(
      resolveScheduledCallBanner(scheduledCall(), { canReschedule: false })
        ?.showActions,
    ).toBe(true);
  });

  it("carries the pending Meet state through to the banner", () => {
    // The banner reads it off the record to say "Calendar is still preparing
    // the link", so an announceable call has to arrive with it intact.
    const call = scheduledCall({
      conferenceJoinUrl: null,
      conferencePending: true,
    });

    expect(resolveScheduledCallBanner(call)?.call.conferencePending).toBe(true);
  });
});

// The decision bar decides on the candidate. Once a call exists it carries a
// compact chip that points AT the banner — never the call's full result card,
// and never back into the dialog, which the server would reject.
describe("resolveScheduleTrigger", () => {
  it("offers the schedule call-to-action when nothing is booked", () => {
    expect(resolveScheduleTrigger(null)).toEqual({ kind: "schedule" });
  });

  it("keeps the call-to-action after a provider error so the retry stays reachable", () => {
    expect(
      resolveScheduleTrigger(scheduledCall({ status: "provider_error" })),
    ).toEqual({ kind: "schedule" });
  });

  it("carries the booked slot once a call exists", () => {
    expect(resolveScheduleTrigger(scheduledCall())).toEqual({
      kind: "booked",
      startsAt: "2026-08-29T15:40:00.000Z",
      timeZone: "Europe/Paris",
    });
  });

  it("falls back to the call-to-action when the stored start time cannot be read", () => {
    expect(
      resolveScheduleTrigger(scheduledCall({ startsAt: "not-a-date" })),
    ).toEqual({ kind: "schedule" });
  });
});

describe("scheduledCallBannerId", () => {
  it("stays usable as a fragment identifier", () => {
    // The chip links to `#${scheduledCallBannerId}` and the banner carries it
    // as an `id`. A value with whitespace or a `#` would break the anchor
    // silently — the click would simply do nothing.
    expect(scheduledCallBannerId).toMatch(/^[A-Za-z][\w-]*$/u);
  });
});

describe("formatCompactCallLabel", () => {
  it("renders a day-and-time label in the call's own time zone", () => {
    expect(
      formatCompactCallLabel({
        locale: "fr-FR",
        startsAt: "2026-08-29T15:40:00.000Z",
        timeZone: "Europe/Paris",
      }),
    ).toBe("29 août · 17:40");
  });

  it("follows the reader's locale for month order and clock", () => {
    expect(
      formatCompactCallLabel({
        locale: "en-US",
        startsAt: "2026-08-29T15:40:00.000Z",
        timeZone: "Europe/Paris",
      }),
    ).toBe("Aug 29 · 5:40 PM");
  });

  it("returns null when the start time cannot be read", () => {
    expect(
      formatCompactCallLabel({
        locale: "fr-FR",
        startsAt: "not-a-date",
        timeZone: "Europe/Paris",
      }),
    ).toBeNull();
  });

  it("falls back to the reader's zone rather than throwing on an unusable stored zone", () => {
    // This now renders inside the page, not only in a floating bar: a
    // RangeError from `Intl` would take the whole candidate review down.
    expect(
      formatCompactCallLabel({
        locale: "fr-FR",
        startsAt: "2026-08-29T15:40:00.000Z",
        timeZone: "Mars/Olympus",
      }),
    ).toMatch(/^\d{1,2} \S+ · \d{1,2}:\d{2}$/u);
  });
});

describe("formatScheduledDate", () => {
  it("renders the full date and time in the call's own time zone", () => {
    expect(
      formatScheduledDate("2026-08-29T15:40:00.000Z", "Europe/Paris", "fr-FR"),
    ).toBe("29 août 2026, 17:40");
  });

  it("returns null when the start time cannot be read", () => {
    expect(
      formatScheduledDate("not-a-date", "Europe/Paris", "fr-FR"),
    ).toBeNull();
  });

  it("falls back to the reader's zone rather than throwing on an unusable stored zone", () => {
    expect(
      formatScheduledDate("2026-08-29T15:40:00.000Z", "Mars/Olympus", "en-GB"),
    ).toContain("2026");
  });
});

/*
 * The prefill is not a convenience — it is what makes rescheduling work.
 *
 * The server treats an absent guest as a REMOVED guest, and refuses to remove
 * (`reschedule_unsupported`, see candidate-call-scheduling.ts). So a form that
 * opened empty would turn "move this call by an hour" into "un-invite everyone
 * and drop the Meet link", and the recruiter would be refused for something
 * they never asked for. Every field the server compares has to come back out of
 * the record exactly as it went in.
 */
describe("resolveScheduleCallPrefill", () => {
  it("opens an empty form on the product's defaults when nothing is booked", () => {
    expect(
      resolveScheduleCallPrefill({
        candidateEmail: "Ada@Example.com",
        scheduledCall: null,
      }),
    ).toEqual({
      addConference: true,
      candidateEmail: "Ada@Example.com",
      dateTime: "",
      durationMinutes: "30",
      guestEmails: "",
      inviteCandidate: true,
      isReschedule: false,
      location: "",
      timeZone: null,
    });
  });

  it("leaves the invitation off when the candidate has no address on file", () => {
    expect(
      resolveScheduleCallPrefill({
        candidateEmail: null,
        scheduledCall: null,
      }),
    ).toMatchObject({ candidateEmail: "", inviteCandidate: false });
  });

  it("seeds a wall clock the browser turns back into the very same instant", () => {
    // `datetime-local` speaks the reader's own zone, and the form converts it
    // back with `new Date(value)`. Round-tripping through that pair is the
    // whole contract: anything else moves a call nobody asked to move.
    const call = scheduledCall();
    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "ada@example.com",
      scheduledCall: call,
    });

    expect(prefill.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
    // Read back through the very function the form submits with, so the two
    // halves of the conversion cannot drift apart unnoticed.
    expect(toBrowserIsoInstant(prefill.dateTime)).toBe(call.startsAt);
  });

  it("derives the duration from the stored interval rather than a stored field", () => {
    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "ada@example.com",
      scheduledCall: scheduledCall({
        endsAt: "2026-08-29T16:25:00.000Z",
        startsAt: "2026-08-29T15:40:00.000Z",
      }),
    });

    expect(prefill.durationMinutes).toBe("45");
  });

  it("falls back to the default duration when the stored interval is not on the menu", () => {
    // The four options are the only durations the policy can write, so this is
    // a row edited outside the product. The select cannot show 37 minutes, and
    // inventing a value the recruiter never picked is worse than defaulting.
    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "ada@example.com",
      scheduledCall: scheduledCall({
        endsAt: "2026-08-29T16:17:00.000Z",
        startsAt: "2026-08-29T15:40:00.000Z",
      }),
    });

    expect(prefill.durationMinutes).toBe("30");
  });

  it("splits the stored attendees back into the invitation and the guest field", () => {
    // The candidate is not a guest: the invitation switch owns that address,
    // and the server refuses a schedule that lists it as one.
    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "Ada@Example.com",
      scheduledCall: scheduledCall({
        attendeeEmails: ["ada@example.com", "hiring@example.com"],
        inviteCandidate: true,
      }),
    });

    expect(prefill).toMatchObject({
      candidateEmail: "Ada@Example.com",
      guestEmails: "hiring@example.com",
      inviteCandidate: true,
    });
  });

  it("keeps every attendee as a guest when the candidate was never invited", () => {
    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "ada@example.com",
      scheduledCall: scheduledCall({
        attendeeEmails: ["hiring@example.com", "manager@example.com"],
        inviteCandidate: false,
      }),
    });

    expect(prefill).toMatchObject({
      guestEmails: "hiring@example.com, manager@example.com",
      inviteCandidate: false,
    });
  });

  it("carries the stored location and Meet choice back into the form", () => {
    expect(
      resolveScheduleCallPrefill({
        candidateEmail: "ada@example.com",
        scheduledCall: scheduledCall({
          conferenceRequested: false,
          location: null,
        }),
      }),
    ).toMatchObject({ addConference: false, location: "" });
  });

  it("keeps the call's own time zone so a move never quietly rewrites it", () => {
    // `null` means "ask the browser" — right for a call that does not exist
    // yet, wrong for one Google already holds in a zone of its own.
    expect(
      resolveScheduleCallPrefill({
        candidateEmail: "ada@example.com",
        scheduledCall: scheduledCall(),
      }).timeZone,
    ).toBe("Europe/Paris");
  });

  it("prefills a failed booking with its original details but keeps the create copy", () => {
    // Google never created this event, so nothing is being moved — but the
    // server only accepts a retry that repeats the original details, which is
    // exactly what the prefill hands it.
    const prefill = resolveScheduleCallPrefill({
      candidateEmail: "ada@example.com",
      scheduledCall: scheduledCall({ status: "provider_error" }),
    });

    expect(prefill.isReschedule).toBe(false);
    expect(prefill.location).toBe("Paris office");
    expect(toBrowserIsoInstant(prefill.dateTime)).toBe(
      "2026-08-29T15:40:00.000Z",
    );
  });

  it("calls a confirmed booking a reschedule", () => {
    expect(
      resolveScheduleCallPrefill({
        candidateEmail: "ada@example.com",
        scheduledCall: scheduledCall(),
      }).isReschedule,
    ).toBe(true);
  });

  it("opens an empty form when the stored start time cannot be read", () => {
    // Nothing about this row can be trusted to round-trip, and a form seeded
    // from an unreadable instant would submit a slot nobody chose.
    expect(
      resolveScheduleCallPrefill({
        candidateEmail: "ada@example.com",
        scheduledCall: scheduledCall({ startsAt: "not-a-date" }),
      }),
    ).toMatchObject({ dateTime: "", durationMinutes: "30", location: "" });
  });
});
