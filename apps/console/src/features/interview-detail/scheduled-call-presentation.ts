/**
 * What a scheduled follow-up call looks like on the candidate review page,
 * decided in one pure place.
 *
 * The scheduled call used to be rendered entirely inside the floating decision
 * bar — a light result card, with links, sitting inside a dark bar whose only
 * job is advance / hold / pass. The durable facts now live in a banner under
 * the page header and the bar keeps a compact chip pointing at it, so two
 * surfaces read the same record and must agree on when there is anything to
 * show at all. That agreement is this module; the components only paint it.
 */

import { candidateCallDurationOptions } from "../../domain/candidate-call-scheduling-policy";

/**
 * The anchor both surfaces share. The chip is fixed to the bottom of a long
 * candidate page and the banner sits at the very top, so the chip's whole job
 * is to carry the recruiter there — which needs one id neither side invents.
 */
export const scheduledCallBannerId = "scheduled-call";

export type ScheduledCallSummary = {
  attendeeEmails: string[];
  conferenceJoinUrl: string | null;
  conferencePending: boolean;
  conferenceRequested: boolean;
  endsAt: string;
  eventUrl: string | null;
  invitationSent: boolean;
  inviteCandidate: boolean;
  location: string | null;
  startsAt: string;
  status: "provider_error" | "scheduled";
  timeZone: string;
};

export type ScheduledCallBannerView = {
  call: ScheduledCallSummary;
  invitationMessageKey:
    | "schedule.nextCallInvitationSent"
    | "schedule.nextCallPrivateEvent";
  showActions: boolean;
  showMeetPending: boolean;
  showReschedule: boolean;
};

export type ScheduleTriggerView =
  | { kind: "booked"; startsAt: string; timeZone: string }
  | { kind: "schedule" };

/**
 * A call is announceable when the provider confirmed it AND we can place it in
 * time. `provider_error` is deliberately excluded: Google never created the
 * event, nobody was invited, and the scheduling call-to-action is still the
 * honest affordance (the server accepts a retry with the same details).
 */
function isAnnounceable(
  call: ScheduledCallSummary | null,
): call is ScheduledCallSummary {
  return (
    call !== null &&
    call.status === "scheduled" &&
    !Number.isNaN(new Date(call.startsAt).getTime())
  );
}

export function resolveScheduledCallBanner(
  call: ScheduledCallSummary | null,
  options: { canReschedule?: boolean } = {},
): ScheduledCallBannerView | null {
  if (!isAnnounceable(call)) {
    return null;
  }

  // A private event with no Meet link has nowhere to send the recruiter; the
  // banner must not reserve a row of whitespace for buttons that never come.
  const hasLinks = Boolean(call.eventUrl ?? call.conferenceJoinUrl);
  // Moving the call belongs beside the links, not in the decision bar: this is
  // the one surface that states where the call lives, so it is also where you
  // change it. Viewers never see it — the server would refuse them anyway.
  const showReschedule = options.canReschedule === true;

  return {
    call,
    invitationMessageKey: call.invitationSent
      ? "schedule.nextCallInvitationSent"
      : "schedule.nextCallPrivateEvent",
    showActions: hasLinks || showReschedule,
    // Calendar creates the Meet link asynchronously, so "no join link yet" is
    // a wait, not a failure — but only while the request is still pending.
    showMeetPending: call.conferencePending,
    showReschedule,
  };
}

/**
 * What the decision bar's action slot offers. `booked` is deliberately NOT a
 * second way into the scheduling dialog, even now that the dialog can move a
 * call: one surface owns the booked call, and that is the banner. The bar is
 * fixed to the bottom of a long candidate page while the call's details — and
 * its Reschedule action — sit at the top, so the chip's job is to close that
 * distance, not to duplicate what it lands on.
 */
export function resolveScheduleTrigger(
  call: ScheduledCallSummary | null,
): ScheduleTriggerView {
  if (!isAnnounceable(call)) {
    return { kind: "schedule" };
  }

  return {
    kind: "booked",
    startsAt: call.startsAt,
    timeZone: call.timeZone,
  };
}

/**
 * Every field the scheduling form starts from, read out of the call the
 * recruiter already booked.
 *
 * This is load-bearing, not a convenience. The server reads a schedule as the
 * complete guest list and conference choice for the event, so a field the form
 * left empty is a REMOVAL — and phase 1 refuses removals outright
 * (`reschedule_unsupported`). An empty form would therefore turn "move this by
 * an hour" into a refusal for something the recruiter never asked for. Handing
 * every stored value back is what makes an untouched resubmission land on the
 * server's identical-schedule no-op instead.
 *
 * `timeZone: null` means "ask the browser" — the right answer for a call that
 * does not exist yet, and the wrong one for a call Google already holds in a
 * zone of its own.
 */
export type ScheduleCallFormPrefill = {
  addConference: boolean;
  candidateEmail: string;
  dateTime: string;
  durationMinutes: string;
  guestEmails: string;
  inviteCandidate: boolean;
  isReschedule: boolean;
  location: string;
  timeZone: string | null;
};

const defaultDurationMinutes = "30";

export function resolveScheduleCallPrefill({
  candidateEmail,
  scheduledCall,
}: {
  candidateEmail: string | null;
  scheduledCall: ScheduledCallSummary | null;
}): ScheduleCallFormPrefill {
  const blankForm: ScheduleCallFormPrefill = {
    addConference: true,
    candidateEmail: candidateEmail ?? "",
    dateTime: "",
    durationMinutes: defaultDurationMinutes,
    guestEmails: "",
    inviteCandidate: Boolean(candidateEmail),
    isReschedule: false,
    location: "",
    timeZone: null,
  };

  const dateTime = scheduledCall
    ? toDateTimeLocalValue(scheduledCall.startsAt)
    : "";
  // An unreadable instant cannot round-trip, and a form seeded from one would
  // submit a slot nobody chose. Nothing else on the row is worth keeping then.
  if (!scheduledCall || !dateTime) {
    return blankForm;
  }

  const candidateAddress = normalizeEmail(candidateEmail);

  return {
    addConference: scheduledCall.conferenceRequested,
    candidateEmail: candidateEmail ?? "",
    dateTime,
    durationMinutes: toDurationMinutes(scheduledCall),
    // The candidate is not a guest. Their address belongs to the invitation
    // switch, and the server refuses a schedule that lists it in both places.
    guestEmails: scheduledCall.attendeeEmails
      .filter(
        (email) =>
          !scheduledCall.inviteCandidate ||
          normalizeEmail(email) !== candidateAddress,
      )
      .join(", "),
    inviteCandidate: scheduledCall.inviteCandidate,
    // A `provider_error` row prefills exactly the same way — the server only
    // accepts a retry that repeats the original details — but Google never
    // created that event, so it is still a first booking and keeps that copy.
    isReschedule: scheduledCall.status === "scheduled",
    location: scheduledCall.location ?? "",
    timeZone: scheduledCall.timeZone,
  };
}

/**
 * The stored interval, expressed as one of the durations the form can offer.
 * Those four are the only values the policy can ever have written, so anything
 * else is a row edited outside the product: the select cannot show it, and
 * inventing a duration the recruiter never picked is worse than defaulting.
 */
function toDurationMinutes(call: { endsAt: string; startsAt: string }) {
  const minutes =
    (new Date(call.endsAt).getTime() - new Date(call.startsAt).getTime()) /
    60_000;

  return candidateCallDurationOptions.includes(minutes as 15 | 30 | 45 | 60)
    ? String(minutes)
    : defaultDurationMinutes;
}

/**
 * An instant, written as the wall clock `<input type="datetime-local">` speaks
 * — the reader's own. The form converts it back with `new Date(value)`, which
 * reads it in that same zone, so the pair round-trips the instant exactly.
 * (Seconds are dropped, which the input has no way to express anyway; every
 * slot the product itself writes lands on a whole minute.)
 */
function toDateTimeLocalValue(startsAt: string) {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/**
 * The other half of that pair: the wall clock the recruiter sees, read back as
 * the instant the server stores. It lives here, next to the value the prefill
 * writes, precisely so the two cannot drift apart — a form that read the input
 * differently from the way the prefill wrote it would move every call it
 * touched by exactly the difference.
 */
export function toBrowserIsoInstant(dateTimeLocal: string) {
  if (!dateTimeLocal) {
    return "";
  }

  const date = new Date(dateTimeLocal);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeEmail(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

/**
 * The stored zone comes from whichever browser booked the call, so it is not
 * guaranteed to be a zone this reader's `Intl` knows. Both formatters degrade
 * to the reader's own zone rather than throw: this copy now renders inside the
 * page, where a `RangeError` would take the whole candidate review down.
 */
function safeFormat(
  startsAt: string,
  timeZone: string,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string | null {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
      date,
    );
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

/** The full, unambiguous statement of when the call happens — for the banner. */
export function formatScheduledDate(
  startsAt: string,
  timeZone: string,
  locale?: string,
): string | null {
  return safeFormat(startsAt, timeZone, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The chip's whole content, so it stays a glance and not a sentence: day,
 * month and clock time, ordered by the reader's locale ("29 août · 17:40",
 * "Aug 29 · 5:40 PM"). The year is dropped on purpose — a follow-up call is
 * always near, and the banner above carries the full date anyway.
 */
export function formatCompactCallLabel({
  locale,
  startsAt,
  timeZone,
}: {
  locale?: string;
  startsAt: string;
  timeZone: string;
}): string | null {
  const day = safeFormat(startsAt, timeZone, locale, {
    day: "numeric",
    month: "short",
  });
  const time = safeFormat(startsAt, timeZone, locale, {
    hour: "numeric",
    minute: "2-digit",
  });

  return day && time ? `${day} · ${time}` : null;
}
