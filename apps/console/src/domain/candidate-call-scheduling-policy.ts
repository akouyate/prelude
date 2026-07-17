export const candidateCallDurationOptions = [15, 30, 45, 60] as const;

export type ValidatedCandidateCallSchedule = {
  addConference: boolean;
  attendeeEmails: string[];
  candidateEmail: string | null;
  endsAt: Date;
  inviteCandidate: boolean;
  location: string | null;
  startsAt: Date;
  timeZone: string;
};

export function validateCandidateCallSchedule(input: {
  addConference: unknown;
  candidateEmail: unknown;
  durationMinutes: unknown;
  guestEmails: unknown;
  inviteCandidate: unknown;
  location: unknown;
  startsAt: unknown;
  timeZone: unknown;
}):
  | { ok: true; value: ValidatedCandidateCallSchedule }
  | { error: string; ok: false } {
  const startsAt = readIsoDate(input.startsAt);
  if (!startsAt) {
    return { error: "Choose a valid date and start time.", ok: false };
  }

  const durationMinutes = Number(input.durationMinutes);
  if (
    !candidateCallDurationOptions.includes(durationMinutes as 15 | 30 | 45 | 60)
  ) {
    return { error: "Choose a supported call duration.", ok: false };
  }

  const timeZone = readTimeZone(input.timeZone);
  if (!timeZone) {
    return { error: "Choose a valid time zone.", ok: false };
  }

  const candidateEmail = readOptionalEmail(input.candidateEmail);
  if (input.candidateEmail && !candidateEmail) {
    return { error: "Enter a valid candidate email address.", ok: false };
  }

  const guestEmails = readEmailList(input.guestEmails);
  if (!guestEmails.ok) {
    return guestEmails;
  }

  const inviteCandidate = input.inviteCandidate === "on";
  if (inviteCandidate && !candidateEmail) {
    return {
      error: "A candidate email is required before sending an invitation.",
      ok: false,
    };
  }

  const attendeeEmails = deduplicateEmails([
    ...(inviteCandidate && candidateEmail ? [candidateEmail] : []),
    ...guestEmails.value,
  ]);
  if (
    !inviteCandidate &&
    candidateEmail &&
    guestEmails.value.includes(candidateEmail)
  ) {
    return {
      error: "Enable the candidate invitation to add the candidate as a guest.",
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      addConference: input.addConference === "on",
      attendeeEmails,
      candidateEmail,
      endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
      inviteCandidate,
      location: readOptionalText(input.location, 160),
      startsAt,
      timeZone,
    },
  };
}

function readIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now()
    ? null
    : date;
}

function readTimeZone(value: unknown) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

function readOptionalEmail(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

function readEmailList(
  value: unknown,
): { ok: true; value: string[] } | { error: string; ok: false } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: true, value: [] };
  }

  const emails = value
    .split(/[;,\n]/u)
    .map((email) => readOptionalEmail(email));
  if (emails.some((email) => !email)) {
    return { error: "Guest emails must all be valid.", ok: false };
  }

  return {
    ok: true,
    value: emails.filter((email): email is string => Boolean(email)),
  };
}

function readOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

function deduplicateEmails(emails: string[]) {
  return [...new Set(emails)];
}
