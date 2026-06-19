import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@prelude/db";

import { isClerkConfigured } from "../auth/clerk-config";

export type ConsoleDashboardData = {
  organization: {
    id: string;
    companySize: string | null;
    defaultInterviewMode: string | null;
    hiringFocus: string | null;
    name: string;
  };
  jobs: Array<{
    description: string;
    id: string;
    location: string | null;
    sourceProvider: string | null;
    status: string;
    title: string;
  }>;
  connectors: Array<{
    provider: string;
    status: string;
  }>;
};

export async function getConsoleDashboardData(): Promise<ConsoleDashboardData> {
  if (!isClerkConfigured) {
    return mockDashboardData;
  }

  const authState = await auth();

  if (!authState.userId) {
    throw new Error("Authenticated user is required.");
  }

  const membership = await prisma.organizationMembership.findFirst({
    include: {
      organization: {
        include: {
          jobs: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          jobSourceConnections: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
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
    connectors: membership.organization.jobSourceConnections.map((connector) => ({
      provider: connector.provider,
      status: connector.status,
    })),
    jobs: membership.organization.jobs.map((job) => ({
      description: job.description,
      id: job.id,
      location: job.location,
      sourceProvider: job.sourceProvider,
      status: job.status,
      title: job.title,
    })),
    organization: {
      id: membership.organization.id,
      companySize: membership.organization.companySize,
      defaultInterviewMode: membership.organization.defaultInterviewMode,
      hiringFocus: membership.organization.hiringFocus,
      name: membership.organization.name,
    },
  };
}

const mockDashboardData: ConsoleDashboardData = {
  connectors: [{ provider: "manual", status: "manual" }],
  jobs: [
    {
      description:
        "We are hiring a Customer Success Manager to onboard SMB customers, reduce churn risk, coordinate with product teams, and turn customer feedback into practical improvements.",
      id: "job_demo",
      location: "Paris",
      sourceProvider: "manual",
      status: "draft",
      title: "Customer Success Manager",
    },
  ],
  organization: {
    id: "org_demo",
    companySize: "11-50",
    defaultInterviewMode: "Voice first",
    hiringFocus: "Customer-facing",
    name: "Acme Talent",
  },
};
