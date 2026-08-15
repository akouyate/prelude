/**
 * Kill switch for the prepaid-credit admission path. Same convention as
 * `isEnabled()` in `server.ts`: unset or anything other than `"1"`/`"true"`/`"yes"`
 * (case-insensitive, trimmed) is off. The accepted set is kept identical on purpose
 * — an operator who writes `CREDIT_BILLING_ENABLED=yes` because the neighbouring
 * flags accept it must not silently get a kill switch that stayed off.
 */
const ENABLED_VALUES = ["1", "true", "yes"];

export function isCreditBillingEnabled(): boolean {
  return ENABLED_VALUES.includes(
    process.env.CREDIT_BILLING_ENABLED?.trim().toLowerCase() ?? "",
  );
}
