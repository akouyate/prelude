/**
 * #6 — build a pre-filled `mailto:` link so a recruiter can invite a candidate to
 * their interview straight from their own mail client (zero backend; server-side
 * email sending is tracked separately). Uses encodeURIComponent so spaces become
 * %20 (not +), which mail clients render correctly.
 */
export function buildCandidateInviteMailto(
  subject: string,
  body: string,
): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
