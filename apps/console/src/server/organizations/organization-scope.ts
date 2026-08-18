import "server-only";

import { cache } from "react";
import { prisma } from "@prelude/db";

import {
  hasAuthenticatedClerkUser,
  mapClerkOrganizationRole,
  resolveCompletedOrganizationScope,
  type CompletedOrganizationScope,
} from "../../domain/organization-access-policy";
import {
  getConsoleAuthSession,
  type ConsoleAuthSession,
  mockUserEmail,
  mockUserName,
} from "../auth/console-auth-provider";

// Deduped per request: the workspace layout guard, the nav counts, and each
// page loader all need the scope, and every miss costs an auth read plus a
// membership query.
export const getCompletedOrganizationScope = cache(
  async function getCompletedOrganizationScope(): Promise<CompletedOrganizationScope> {
    const authSession = await getConsoleAuthSession();

    if (!authSession.ok) {
      throw new Error(authSession.error);
    }

    if (!hasAuthenticatedClerkUser(authSession.value.userId)) {
      throw new Error("Authenticated user is required.");
    }

    if (authSession.value.source === "mock") {
      return ensureDevelopmentOrganizationScope(authSession.value);
    }

    const memberships = await prisma.organizationMembership.findMany({
      include: {
        organization: true,
      },
      orderBy: { createdAt: "asc" },
      where: {
        status: "active",
        user: { clerkUserId: authSession.value.userId },
      },
    });
    const scope = resolveCompletedOrganizationScope({
      clerkOrganizationId: authSession.value.clerkOrganizationId,
      clerkUserId: authSession.value.userId,
      memberships,
    });

    if (!scope) {
      throw new Error("Completed onboarding is required.");
    }

    return scope;
  },
);

async function ensureDevelopmentOrganizationScope(
  authSession: ConsoleAuthSession,
): Promise<CompletedOrganizationScope> {
  const user = await ensureDevelopmentUser(authSession.userId);

  if (authSession.clerkOrganizationId) {
    const organization = await ensureDevelopmentOrganization(
      authSession.clerkOrganizationId,
    );
    const membership = await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: {
        role: authSession.role,
        status: "active",
      },
      create: {
        onboardingRole: "Founder",
        organizationId: organization.id,
        role: authSession.role,
        status: "active",
        userId: user.id,
      },
    });

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      clerkOrganizationId: null,
      userId: user.id,
      role: mapClerkOrganizationRole(membership.role, authSession.role),
    };
  }

  const existingMembership = await prisma.organizationMembership.findFirst({
    include: { organization: true },
    orderBy: { createdAt: "asc" },
    where: {
      status: "active",
      userId: user.id,
      organization: {
        onboardingCompletedAt: { not: null },
      },
    },
  });

  if (existingMembership) {
    return {
      organizationId: existingMembership.organizationId,
      organizationName: existingMembership.organization.name,
      clerkOrganizationId: null,
      userId: user.id,
      role: mapClerkOrganizationRole(existingMembership.role, "viewer"),
    };
  }

  const organization = await createDevelopmentOrganization({
    clerkOrganizationId: null,
    userId: user.id,
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    clerkOrganizationId: null,
    userId: user.id,
    role: "owner",
  };
}

async function ensureDevelopmentUser(clerkUserId: string) {
  const email = mockUserEmail();
  const name = mockUserName();
  const existingByClerkId = await prisma.user.findUnique({
    where: { clerkUserId },
  });

  // DEVIATION (plan 2026-08-18, Part 1): this used to unconditionally
  // re-sync email+name from the MOCK_CLERK_USER_* env vars on EVERY request
  // that resolves scope — which is most of them. That silently reverted any
  // edit to the mock user's name back to the env default on the very next
  // page load, making the newly-editable profile name a no-op under the
  // mock auth provider (the only provider this repo can exercise without
  // real Clerk credentials — `make dev`, Playwright's default, and this
  // plan's own browser proof all run mock). Once the row exists, it is the
  // durable identity; only bootstrap (the branches below, for a row that
  // doesn't exist yet under this clerkUserId) may set it from env.
  if (existingByClerkId) {
    return existingByClerkId;
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
  });

  if (existingByEmail) {
    return prisma.user.update({
      data: { clerkUserId, name },
      where: { id: existingByEmail.id },
    });
  }

  return prisma.user.create({
    data: {
      clerkUserId,
      email,
      name,
    },
  });
}

async function ensureDevelopmentOrganization(clerkOrganizationId: string) {
  return prisma.organization.upsert({
    where: { clerkOrganizationId },
    create: developmentOrganizationData({
      clerkOrganizationId,
    }),
    update: {
      onboardingCompletedAt: new Date(),
    },
  });
}

function createDevelopmentOrganization({
  clerkOrganizationId,
  userId,
}: {
  clerkOrganizationId: string | null;
  userId?: string;
}) {
  return prisma.organization.create({
    data: developmentOrganizationData({ clerkOrganizationId, userId }),
  });
}

function developmentOrganizationData({
  clerkOrganizationId,
  userId,
}: {
  clerkOrganizationId: string | null;
  userId?: string;
}) {
  return {
    clerkOrganizationId,
    companySize: "11-50",
    defaultInterviewMode: "Voice first",
    hiringFocus: "Customer-facing",
    name: "Acme Talent",
    onboardingCompletedAt: new Date(),
    ...(userId
      ? {
          memberships: {
            create: {
              onboardingRole: "Founder",
              role: "owner",
              status: "active",
              userId,
            },
          },
        }
      : {}),
    jobs: {
      create: {
        description:
          "We are hiring a Customer Success Manager to onboard SMB customers, reduce churn risk, coordinate with product teams, and turn customer feedback into practical improvements.",
        location: "Paris",
        sourceExternalId: "manual:customer-success-manager",
        sourceProvider: "manual",
        status: "draft",
        title: "Customer Success Manager",
      },
    },
    jobSourceConnections: {
      create: {
        externalLabel: "Manual job entry",
        provider: "manual",
        status: "manual",
      },
    },
  };
}
