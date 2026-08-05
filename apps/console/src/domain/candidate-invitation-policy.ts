/**
 * Field rules for a candidate invitation, kept pure so the server can enforce
 * them for real. The browser's `type="email"` check is a convenience: it never
 * runs for a direct POST, and the recruiter's typo would otherwise reach the
 * database and only surface later, as a failed delivery.
 */
export type CandidateInvitationFieldErrors = {
  candidateEmail?: string;
  candidateName?: string;
  expiresAt?: string;
};

export const MAX_CANDIDATE_NAME_CHARACTERS = 120;
export const MAX_CANDIDATE_INVITATION_DAYS = 180;

// Deliberately permissive: this rejects what is obviously not an address rather
// than trying to out-guess RFC 5322. Deliverability is decided by the mail
// provider, not here.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateCandidateInvitation(
  input: {
    candidateEmail: string;
    candidateName: string;
    expiresAt: string;
  },
  now: Date,
): CandidateInvitationFieldErrors {
  const errors: CandidateInvitationFieldErrors = {};

  const name = input.candidateName.trim();
  if (name.length > MAX_CANDIDATE_NAME_CHARACTERS) {
    errors.candidateName = `Use ${MAX_CANDIDATE_NAME_CHARACTERS} characters or fewer for the candidate name.`;
  }

  const email = input.candidateEmail.trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.candidateEmail =
      "Enter a valid email address, or leave this empty to share the link yourself.";
  }

  const expiresAtError = validateExpiry(input.expiresAt.trim(), now);
  if (expiresAtError) {
    errors.expiresAt = expiresAtError;
  }

  return errors;
}

export function hasCandidateInvitationErrors(
  errors: CandidateInvitationFieldErrors,
): boolean {
  return Object.keys(errors).length > 0;
}

function validateExpiry(value: string, now: Date): string | null {
  if (!value) {
    return null;
  }

  const expiresAt = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    return "Enter a valid expiry date, or leave this empty for the 30-day default.";
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return "Choose an expiry date in the future.";
  }

  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + MAX_CANDIDATE_INVITATION_DAYS);
  if (expiresAt.getTime() > horizon.getTime()) {
    return `Choose an expiry date within ${MAX_CANDIDATE_INVITATION_DAYS} days.`;
  }

  return null;
}
