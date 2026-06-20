import { describe, expect, it } from "vitest";

import {
  hasAuthenticatedClerkUser,
  mapClerkOrganizationRole,
  resolveCompletedOrganizationScope,
  type OrganizationScopeMembershipCandidate,
} from "./organization-access-policy";

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

  it("requires an authenticated Clerk user before resolving access", () => {
    expect(hasAuthenticatedClerkUser("user_1")).toBe(true);
    expect(hasAuthenticatedClerkUser(null)).toBe(false);
    expect(
      resolveCompletedOrganizationScope({
        clerkOrganizationId: null,
        clerkUserId: null,
        memberships: [membership({ organizationId: "org_a" })],
      }),
    ).toBeNull();
  });

  it("resolves the first active completed organization scope", () => {
    expect(
      resolveCompletedOrganizationScope({
        clerkOrganizationId: null,
        clerkUserId: "user_1",
        memberships: [
          membership({ organizationId: "org_a", role: "org:member" }),
          membership({ organizationId: "org_b", role: "org:admin" }),
        ],
      }),
    ).toMatchObject({
      organizationId: "org_a",
      organizationName: "Organization org_a",
      role: "recruiter",
      userId: "user_1",
    });
  });

  it("requires completed onboarding before resolving scope", () => {
    expect(
      resolveCompletedOrganizationScope({
        clerkOrganizationId: null,
        clerkUserId: "user_1",
        memberships: [
          membership({
            onboardingCompletedAt: null,
            organizationId: "org_incomplete",
          }),
        ],
      }),
    ).toBeNull();
  });

  it("requires the selected Clerk organization when one is active", () => {
    expect(
      resolveCompletedOrganizationScope({
        clerkOrganizationId: "clerk_org_target",
        clerkUserId: "user_1",
        memberships: [
          membership({
            clerkOrganizationId: "clerk_org_other",
            organizationId: "org_other",
          }),
          membership({
            clerkOrganizationId: "clerk_org_target",
            organizationId: "org_target",
            role: "owner",
          }),
        ],
      }),
    ).toMatchObject({
      organizationId: "org_target",
      role: "owner",
    });
  });

  it("rejects wrong organization and inactive memberships", () => {
    expect(
      resolveCompletedOrganizationScope({
        clerkOrganizationId: "clerk_org_target",
        clerkUserId: "user_1",
        memberships: [
          membership({
            clerkOrganizationId: "clerk_org_other",
            organizationId: "org_other",
          }),
          membership({
            clerkOrganizationId: "clerk_org_target",
            organizationId: "org_inactive",
            status: "inactive",
          }),
        ],
      }),
    ).toBeNull();
  });
});

function membership(
  overrides: Partial<OrganizationScopeMembershipCandidate> & {
    clerkOrganizationId?: string | null;
    onboardingCompletedAt?: Date | null;
    organizationId: string;
  },
): OrganizationScopeMembershipCandidate {
  const organizationId = overrides.organizationId;

  return {
    organizationId,
    role: overrides.role ?? "viewer",
    status: overrides.status ?? "active",
    userId: overrides.userId ?? "user_1",
    organization: {
      clerkOrganizationId:
        overrides.clerkOrganizationId ?? `clerk_${organizationId}`,
      name: `Organization ${organizationId}`,
      onboardingCompletedAt:
        overrides.onboardingCompletedAt === undefined
          ? new Date("2026-06-20T10:00:00.000Z")
          : overrides.onboardingCompletedAt,
    },
  };
}
