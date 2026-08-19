/**
 * The one way the console decides two email addresses are the same one.
 *
 * Addresses reach the product from three directions — a box the recruiter
 * typed into, the identity provider, and the candidate record — so "same
 * address" has to survive stray spacing and casing. An address that is only
 * whitespace is no address at all, which is why the empty result collapses to
 * `null`: two blanks must not compare equal to each other.
 */
export function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}
