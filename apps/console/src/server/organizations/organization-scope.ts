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
  mockUserEmail,
  mockUserId,
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
    return ensureDevelopmentOrganizationScope();
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

async function ensureDevelopmentOrganizationScope(): Promise<CompletedOrganizationScope> {
  const user = await prisma.user.upsert({
    where: { clerkUserId: mockUserId() },
    update: {
      email: mockUserEmail(),
      name: mockUserName(),
    },
    create: {
      clerkUserId: mockUserId(),
      email: mockUserEmail(),
      name: mockUserName(),
    },
  });

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
      userId: user.id,
      role: mapClerkOrganizationRole(existingMembership.role, "viewer"),
    };
  }

  const organization = await prisma.organization.create({
    data: {
      companySize: "11-50",
      defaultInterviewMode: "Voice first",
      hiringFocus: "Customer-facing",
      name: "Acme Talent",
      onboardingCompletedAt: new Date(),
      memberships: {
        create: {
          onboardingRole: "Founder",
          role: "owner",
          status: "active",
          userId: user.id,
        },
      },
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
    },
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    userId: user.id,
    role: "owner",
  };
}
