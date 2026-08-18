import { describe, expect, it } from "vitest";

import {
  resolveOrganizationRoleFromClerk,
  toClerkMembershipRole,
} from "./clerk-role-sync";

describe("resolveOrganizationRoleFromClerk", () => {
  it("prefers the granular Prelude role carried in publicMetadata when it agrees with Clerk's coarse role", () => {
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "recruiter",
        clerkRole: "org:member",
      }),
    ).toBe("recruiter");
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "viewer",
        clerkRole: "org:member",
      }),
    ).toBe("viewer");
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "owner",
        clerkRole: "org:admin",
      }),
    ).toBe("owner");
  });

  it("trusts a demotion performed in Clerk's own UI over a stale granular role — privilege retention", () => {
    // Clerk's own UIs (the Dashboard, and clerk.openOrganizationProfile which
    // the console opens itself) write only the coarse Clerk role, never
    // publicMetadata.preludeRole. A stale "admin"/"owner" left behind by a
    // demotion to org:member must not resurrect the old privilege level.
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "admin",
        clerkRole: "org:member",
      }),
    ).toBe("recruiter");
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "owner",
        clerkRole: "org:member",
      }),
    ).toBe("recruiter");
  });

  it("trusts a Clerk-side promotion to org:admin over a stale lower-tier granular role", () => {
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "viewer",
        clerkRole: "org:admin",
      }),
    ).toBe("admin");
  });

  it("falls back to the Clerk coarse role when no granular role is set", () => {
    // org:admin -> admin, org:member -> recruiter (a member can operate).
    expect(
      resolveOrganizationRoleFromClerk({ clerkRole: "org:admin" }),
    ).toBe("admin");
    expect(
      resolveOrganizationRoleFromClerk({ clerkRole: "org:member" }),
    ).toBe("recruiter");
  });

  it("ignores an invalid publicMetadata role and falls back", () => {
    expect(
      resolveOrganizationRoleFromClerk({
        publicMetadataRole: "superuser",
        clerkRole: "org:member",
      }),
    ).toBe("recruiter");
  });

  it("defaults to the least-privilege viewer when nothing is known", () => {
    expect(resolveOrganizationRoleFromClerk({})).toBe("viewer");
    expect(
      resolveOrganizationRoleFromClerk({ clerkRole: "org:weird_role" }),
    ).toBe("viewer");
  });
});

describe("toClerkMembershipRole", () => {
  it("maps owner and admin to Clerk's org:admin", () => {
    expect(toClerkMembershipRole("owner")).toBe("org:admin");
    expect(toClerkMembershipRole("admin")).toBe("org:admin");
  });

  it("maps recruiter and viewer to Clerk's org:member", () => {
    expect(toClerkMembershipRole("recruiter")).toBe("org:member");
    expect(toClerkMembershipRole("viewer")).toBe("org:member");
  });
});
