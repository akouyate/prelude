import { describe, expect, it } from "vitest";

import { mapClerkOrganizationRole } from "./organization-access-policy";

describe("organization access policy", () => {
  it.each([
    ["org:admin", "admin"],
    ["admin", "admin"],
    ["org:member", "recruiter"],
    ["member", "recruiter"],
    ["owner", "owner"],
    ["recruiter", "recruiter"],
    ["viewer", "viewer"],
  ] as const)("maps Clerk role %s to Prelude role %s", (input, expected) => {
    expect(mapClerkOrganizationRole(input, "owner")).toBe(expected);
  });

  it("uses the provided fallback when Clerk does not expose a role", () => {
    expect(mapClerkOrganizationRole(null, "owner")).toBe("owner");
    expect(mapClerkOrganizationRole(undefined, "viewer")).toBe("viewer");
  });

  it("downgrades unknown roles to viewer", () => {
    expect(mapClerkOrganizationRole("org:billing", "owner")).toBe("viewer");
  });
});
