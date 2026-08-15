/**
 * Kill switch for the prepaid-credit admission path. Same convention as
 * `isEnabled()` in `server.ts`: unset or anything other than `"1"`/`"true"`
 * (case-insensitive, trimmed) is off.
 */
export function isCreditBillingEnabled(): boolean {
  const raw = process.env.CREDIT_BILLING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
