import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import type { OrganizationUserContext } from "@prelude/types";

import { isClerkConfigured } from "./clerk-config";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

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

    const scope = await getCompletedOrganizationScope();

    return {
      ...mockConsoleContext,
      organizationId: scope.organizationId,
      organizationName: scope.organizationName,
      userId: scope.userId,
      role: scope.role,
    };
  }

  const authState = await auth();
  const userId = authState.userId;

  if (!userId) {
    throw new Error("Authenticated user is required.");
  }

  const [scope, user] = await Promise.all([
    getCompletedOrganizationScope(),
    currentUser(),
  ]);
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  return {
    organizationId: scope.organizationId,
    organizationName: scope.organizationName,
    userId,
    userName: user?.fullName ?? user?.firstName ?? userEmail,
    userEmail,
    role: scope.role,
  };
}
