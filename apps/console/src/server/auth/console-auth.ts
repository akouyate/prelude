import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import type { OrganizationRole, OrganizationUserContext } from "@prelude/types";

import { isClerkConfigured } from "./clerk-config";

const roleMap: Record<string, OrganizationRole> = {
  "org:admin": "admin",
  "org:member": "recruiter",
  admin: "admin",
  member: "recruiter",
  owner: "owner",
  recruiter: "recruiter",
  viewer: "viewer",
};

const mockConsoleContext: OrganizationUserContext = {
  organizationId: "org_demo",
  organizationName: "Acme Talent",
  userId: "user_demo",
  userName: "Adrien Kouyate",
  userEmail: "recruiter@prelude.ai",
  role: "owner",
};

export async function getConsoleAuthContext(): Promise<OrganizationUserContext> {
  if (!isClerkConfigured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Clerk is not configured for the console application.");
    }

    return mockConsoleContext;
  }

  const authState = await auth();
  const userId = authState.userId;

  if (!userId) {
    throw new Error("Authenticated user is required.");
  }

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  const organizationId = authState.orgId ?? "personal";
  const organizationName = authState.orgSlug ?? authState.orgId ?? "Personal workspace";

  return {
    organizationId,
    organizationName,
    userId,
    userName: user?.fullName ?? user?.firstName ?? userEmail,
    userEmail,
    role: mapClerkRole(authState.orgRole),
  };
}

function mapClerkRole(role: string | null | undefined): OrganizationRole {
  if (!role) {
    return "viewer";
  }

  return roleMap[role] ?? "viewer";
}
