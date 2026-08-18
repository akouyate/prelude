import { describe, expect, it } from "vitest";

import {
  organizationCountrySchema,
  workspaceLanguageSchema,
} from "./organization";

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

describe("workspaceLanguageSchema", () => {
  it.each(["en", "fr"])("accepts %s", (value) => {
    expect(workspaceLanguageSchema.safeParse(value).success).toBe(true);
  });

  // Strict like organizationCountrySchema: this is the wire/DTO boundary, not a
  // normalizer. Case-folding and fallbacks live in the console's resolution
  // helpers, which read persisted values that may predate the setting.
  it.each(["EN", "FR", "de", "en-US", "", null, undefined])(
    "rejects %j",
    (value) => {
      expect(workspaceLanguageSchema.safeParse(value).success).toBe(false);
    },
  );
});
