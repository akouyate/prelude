import type { OrganizationRole } from "@prelude/types";

export type CompletedOrganizationScope = {
  organizationId: string;
  organizationName: string;
  // The org's Clerk id, or null for a mock-mode workspace (no real Clerk org).
  // Resolved here once so call sites don't each re-derive it.
  clerkOrganizationId: string | null;
  userId: string;
  role: OrganizationRole;
};

export type OrganizationScopeMembershipCandidate = {
  organizationId: string;
  role: string | null;
  status: string;
  userId: string;
  organization: {
    clerkOrganizationId: string | null;
    name: string;
    onboardingCompletedAt: Date | null;
  };
};

const clerkRoleMap: Record<string, OrganizationRole> = {
  "org:admin": "admin",
  "org:member": "recruiter",
  admin: "admin",
  member: "recruiter",
  owner: "owner",
  recruiter: "recruiter",
  viewer: "viewer",
};

export function mapClerkOrganizationRole(
  role: string | null | undefined,
  fallback: OrganizationRole,
): OrganizationRole {
  if (!role) {
    return fallback;
  }

  return clerkRoleMap[role] ?? "viewer";
}

export function hasAuthenticatedClerkUser(
  clerkUserId: string | null | undefined,
): clerkUserId is string {
  return Boolean(clerkUserId);
}

export function resolveCompletedOrganizationScope({
  clerkOrganizationId,
  clerkUserId,
  memberships,
}: {
  clerkOrganizationId: string | null;
  clerkUserId: string | null;
  memberships: OrganizationScopeMembershipCandidate[];
}): CompletedOrganizationScope | null {
  if (!hasAuthenticatedClerkUser(clerkUserId)) {
    return null;
  }

  const membership = memberships.find((candidate) => {
    if (candidate.status !== "active") {
      return false;
    }

    if (!candidate.organization.onboardingCompletedAt) {
      return false;
    }

    if (
      clerkOrganizationId &&
      candidate.organization.clerkOrganizationId !== clerkOrganizationId
    ) {
      return false;
    }

    return true;
  });

  if (!membership) {
    return null;
  }

  return {
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    clerkOrganizationId: membership.organization.clerkOrganizationId,
    role: mapClerkOrganizationRole(membership.role, "viewer"),
    userId: membership.userId,
  };
}
