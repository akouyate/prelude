import { describe, expect, it } from "vitest";

import { organizationCountrySchema } from "./organization";

describe("organizationCountrySchema", () => {
  it.each([
    "FR",
    "BE",
    "CH",
    "LU",
    "GB",
    "US",
    "CA",
    "OTHER_EU",
    "OTHER_NON_EU",
  ])("accepts %s", (value) => {
    expect(organizationCountrySchema.safeParse(value).success).toBe(true);
  });

  it("accepts null", () => {
    expect(organizationCountrySchema.safeParse(null).success).toBe(true);
  });

  it.each(["DE", "XX", "fr", ""])("rejects %s", (value) => {
    expect(organizationCountrySchema.safeParse(value).success).toBe(false);
  });
});
