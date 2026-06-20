import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { mapClerkOrganizationRole } from "../../domain/organization-access-policy";
import { isClerkConfigured } from "../auth/clerk-config";

export type CompletedOrganizationScope = {
  organizationId: string;
  organizationName: string;
  userId: string;
  role: OrganizationRole;
};

export async function getCompletedOrganizationScope(): Promise<CompletedOrganizationScope> {
  if (!isClerkConfigured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Clerk is not configured for the console application.");
    }

    return ensureDevelopmentOrganizationScope();
  }

  const authState = await auth();

  if (!authState.userId) {
    throw new Error("Authenticated user is required.");
  }

  const membership = await prisma.organizationMembership.findFirst({
    include: {
      organization: true,
      user: true,
    },
    orderBy: { createdAt: "asc" },
    where: {
      status: "active",
      user: { clerkUserId: authState.userId },
      organization: {
        ...(authState.orgId ? { clerkOrganizationId: authState.orgId } : {}),
        onboardingCompletedAt: { not: null },
      },
    },
  });

  if (!membership) {
    throw new Error("Completed onboarding is required.");
  }

  return {
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    userId: membership.userId,
    role: mapRole(membership.role),
  };
}

async function ensureDevelopmentOrganizationScope(): Promise<CompletedOrganizationScope> {
  const user = await prisma.user.upsert({
    where: { clerkUserId: "user_demo" },
    update: {
      email: "recruiter@prelude.ai",
      name: "Adrien Kouyate",
    },
    create: {
      clerkUserId: "user_demo",
      email: "recruiter@prelude.ai",
      name: "Adrien Kouyate",
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
      role: mapRole(existingMembership.role),
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

function mapRole(role: string | null | undefined): OrganizationRole {
  return mapClerkOrganizationRole(role, "viewer");
}
