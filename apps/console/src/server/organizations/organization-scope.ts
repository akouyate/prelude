import "server-only";

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

export async function getCompletedOrganizationScope(): Promise<CompletedOrganizationScope> {
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
}

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

  if (existingByClerkId) {
    return prisma.user.update({
      data: { email, name },
      where: { id: existingByClerkId.id },
    });
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
