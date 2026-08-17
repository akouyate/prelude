import { z } from "zod";

// Curated declared-country list, not the full ISO-3166-1 alpha-2 tail: OTHER_EU / OTHER_NON_EU preserve the EU/non-EU compliance line without enumerating all 249 countries.
export const organizationCountrySchema = z
  .enum(["FR", "BE", "CH", "LU", "GB", "US", "CA", "OTHER_EU", "OTHER_NON_EU"])
  .nullable();

export type OrganizationCountry = z.infer<typeof organizationCountrySchema>;
