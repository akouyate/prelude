import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import type { OrganizationRole } from "@prelude/types";

import { mapClerkOrganizationRole } from "../../domain/organization-access-policy";
import {
  consoleAuthConfigurationError,
  isConsoleAuthMockEnabled,
} from "./clerk-config";

export type ConsoleAuthSession = {
  clerkOrganizationId: string | null;
  role: OrganizationRole;
  source: "clerk" | "mock";
  userId: string;
};

export type ConsoleAuthIdentity = ConsoleAuthSession & {
  userEmail: string;
  userName: string;
};

export type ConsoleAuthResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: string;
    };

export async function getConsoleAuthSession(): Promise<
  ConsoleAuthResult<ConsoleAuthSession>
> {
  if (consoleAuthConfigurationError) {
    return { ok: false, error: consoleAuthConfigurationError };
  }

  if (isConsoleAuthMockEnabled) {
    return getMockConsoleAuthSession();
  }

  const authState = await auth();

  if (!authState.userId) {
    return { ok: false, error: "Authenticated user is required." };
  }

  return {
    ok: true,
    value: {
      clerkOrganizationId: authState.orgId ?? null,
      role: mapClerkOrganizationRole(authState.orgRole, "owner"),
      source: "clerk",
      userId: authState.userId,
    },
  };
}

export async function getConsoleAuthIdentity(): Promise<
  ConsoleAuthResult<ConsoleAuthIdentity>
> {
  const session = await getConsoleAuthSession();

  if (!session.ok) {
    return session;
  }

  if (session.value.source === "mock") {
    return {
      ok: true,
      value: {
        ...session.value,
        userEmail: mockUserEmail(),
        userName: mockUserName(),
      },
    };
  }

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress;

  if (!userEmail) {
    return {
      ok: false,
      error: "Your account needs a primary email address.",
    };
  }

  return {
    ok: true,
    value: {
      ...session.value,
      userEmail,
      userName: user?.fullName ?? user?.firstName ?? userEmail,
    },
  };
}

function getMockConsoleAuthSession(): ConsoleAuthResult<ConsoleAuthSession> {
  return {
    ok: true,
    value: {
      clerkOrganizationId: mockOrganizationId(),
      role: mapClerkOrganizationRole(process.env.MOCK_CLERK_ORG_ROLE, "owner"),
      source: "mock",
      userId: mockUserId(),
    },
  };
}

export function mockUserId() {
  return process.env.MOCK_CLERK_USER_ID || "user_demo";
}

export function mockUserEmail() {
  return process.env.MOCK_CLERK_USER_EMAIL || "recruiter@prelude.ai";
}

export function mockUserName() {
  return process.env.MOCK_CLERK_USER_NAME || "Adrien Kouyate";
}

export function mockOrganizationId() {
  return process.env.MOCK_CLERK_ORG_ID || "org_demo";
}
