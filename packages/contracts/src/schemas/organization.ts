import { z } from "zod";

// Curated declared-country list, not the full ISO-3166-1 alpha-2 tail: OTHER_EU / OTHER_NON_EU preserve the EU/non-EU compliance line without enumerating all 249 countries.
export const organizationCountrySchema = z
  .enum(["FR", "BE", "CH", "LU", "GB", "US", "CA", "OTHER_EU", "OTHER_NON_EU"])
  .nullable();

export type OrganizationCountry = z.infer<typeof organizationCountrySchema>;

// The workspace's generated-content language (plan 2026-08-18, rule 2). Governs
// SHARED generated artifacts only — the candidate brief, its criterion notes and
// the builder rationale — never notifications or UI copy, which stay per-recipient
// through `User.preferredLanguage`. Persisted in `Organization.settings` JSON, so
// the org-profile plan's rule 2 ("No `Organization.preferredLanguage` — ever")
// stands: no column is added here.
export const workspaceLanguageSchema = z.enum(["en", "fr"]);

export type WorkspaceLanguage = z.infer<typeof workspaceLanguageSchema>;

// The shared case-fold + catalogue-validation step for persisted language
// values (DB columns, settings JSON), where "FR" or a stray space is a
// plausible legacy shape. `null` means "this source said nothing usable" —
// callers chain their own fallback on top, and they deliberately differ (the
// console falls back to English, the candidate app to French).
export function parseWorkspaceLanguage(
  value: string | null | undefined,
): WorkspaceLanguage | null {
  const parsed = workspaceLanguageSchema.safeParse(
    (value ?? "").trim().toLowerCase(),
  );

  return parsed.success ? parsed.data : null;
}
