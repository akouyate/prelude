"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma, type PrismaClient } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { isClerkConfigured } from "../auth/clerk-config";

type JobSource = "linkedin" | "indeed" | "manual";

type CompleteOrganizationOnboardingInput = {
  companyName: string;
  companySize: string;
  hiringFocus: string;
  interviewMode: string;
  jobSource: JobSource;
  manualJobTitle?: string;
  onboardingRole: string;
  selectedJob?: {
    id: string;
    location?: string;
    source: string;
    title: string;
  };
};

type CompleteOrganizationOnboardingResult =
  | {
      ok: true;
      jobId: string;
      organizationId: string;
      redirectTo: string;
    }
  | {
      ok: false;
      error: string;
    };

type ValidationResult = { ok: true } | { ok: false; error: string };

const roleMap: Record<string, OrganizationRole> = {
  "org:admin": "admin",
  "org:member": "recruiter",
  admin: "admin",
  member: "recruiter",
  owner: "owner",
  recruiter: "recruiter",
  viewer: "viewer",
};

type OnboardingTransaction = Pick<
  PrismaClient,
  "organization" | "organizationMembership"
>;

export async function completeOrganizationOnboarding(
  input: CompleteOrganizationOnboardingInput,
): Promise<CompleteOrganizationOnboardingResult> {
  const validation = validateInput(input);

  if (!validation.ok) {
    return validation;
  }

  const authContext = await getAuthenticatedOnboardingContext();

  if (!authContext.ok) {
    return authContext;
  }

  const firstJob = resolveFirstJob(input);

  if (!firstJob) {
    return {
      ok: false,
      error: "Select or enter the first job before continuing.",
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { clerkUserId: authContext.userId },
      update: {
        email: authContext.userEmail,
        name: authContext.userName,
      },
      create: {
        clerkUserId: authContext.userId,
        email: authContext.userEmail,
        name: authContext.userName,
      },
    });

    const organization = authContext.clerkOrganizationId
      ? await tx.organization.upsert({
          where: { clerkOrganizationId: authContext.clerkOrganizationId },
          update: organizationData(input),
          create: {
            clerkOrganizationId: authContext.clerkOrganizationId,
            ...organizationData(input),
          },
        })
      : await upsertPersonalOnboardingOrganization(tx, user.id, input);

    await tx.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: {
        onboardingRole: input.onboardingRole,
        role: authContext.role,
        status: "active",
      },
      create: {
        organizationId: organization.id,
        onboardingRole: input.onboardingRole,
        role: authContext.role,
        status: "active",
        userId: user.id,
      },
    });

    await tx.jobSourceConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId: organization.id,
          provider: input.jobSource,
        },
      },
      update: {
        externalLabel: connectionLabel(input.jobSource),
        status: input.jobSource === "manual" ? "manual" : "mock_connected",
      },
      create: {
        externalLabel: connectionLabel(input.jobSource),
        organizationId: organization.id,
        provider: input.jobSource,
        status: input.jobSource === "manual" ? "manual" : "mock_connected",
      },
    });

    const existingJob = await tx.job.findFirst({
      where: {
        organizationId: organization.id,
        sourceExternalId: firstJob.sourceExternalId,
        sourceProvider: input.jobSource,
        title: firstJob.title,
      },
    });

    const job = existingJob
      ? await tx.job.update({
          where: { id: existingJob.id },
          data: firstJob,
        })
      : await tx.job.create({
          data: {
            ...firstJob,
            organizationId: organization.id,
          },
        });

    return {
      jobId: job.id,
      organizationId: organization.id,
    };
  });

  return {
    ok: true,
    ...result,
    redirectTo: `/interviews/new?jobId=${result.jobId}`,
  };
}

function validateInput(
  input: CompleteOrganizationOnboardingInput,
): ValidationResult {
  if (input.companyName.trim().length < 2) {
    return { ok: false, error: "Company name is required." };
  }

  if (!input.companySize || !input.hiringFocus || !input.onboardingRole) {
    return { ok: false, error: "Complete all workspace setup steps first." };
  }

  if (!["linkedin", "indeed", "manual"].includes(input.jobSource)) {
    return { ok: false, error: "Choose a job source before continuing." };
  }

  if (!input.interviewMode) {
    return { ok: false, error: "Choose a candidate answer mode." };
  }

  return { ok: true };
}

async function getAuthenticatedOnboardingContext(): Promise<
  | {
      ok: true;
      clerkOrganizationId: string | null;
      role: OrganizationRole;
      userEmail: string;
      userId: string;
      userName: string;
    }
  | { ok: false; error: string }
> {
  if (!isClerkConfigured) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Authentication is not configured." };
    }

    return {
      ok: true,
      clerkOrganizationId: null,
      role: "owner",
      userEmail: "recruiter@prelude.ai",
      userId: "user_demo",
      userName: "Adrien Kouyate",
    };
  }

  const authState = await auth();

  if (!authState.userId) {
    return { ok: false, error: "Sign in before completing onboarding." };
  }

  const user = await currentUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress;

  if (!userEmail) {
    return { ok: false, error: "Your account needs a primary email address." };
  }

  return {
    ok: true,
    clerkOrganizationId: authState.orgId ?? null,
    role: mapClerkRole(authState.orgRole),
    userEmail,
    userId: authState.userId,
    userName: user?.fullName ?? user?.firstName ?? userEmail,
  };
}

function organizationData(input: CompleteOrganizationOnboardingInput) {
  return {
    companySize: input.companySize,
    defaultInterviewMode: input.interviewMode,
    hiringFocus: input.hiringFocus,
    name: input.companyName.trim(),
    onboardingCompletedAt: new Date(),
  };
}

async function upsertPersonalOnboardingOrganization(
  tx: OnboardingTransaction,
  userId: string,
  input: CompleteOrganizationOnboardingInput,
) {
  const existingMembership = await tx.organizationMembership.findFirst({
    include: { organization: true },
    orderBy: { createdAt: "asc" },
    where: {
      status: "active",
      userId,
    },
  });

  if (existingMembership) {
    return tx.organization.update({
      where: { id: existingMembership.organizationId },
      data: organizationData(input),
    });
  }

  return tx.organization.create({
    data: organizationData(input),
  });
}

function resolveFirstJob(input: CompleteOrganizationOnboardingInput) {
  if (input.jobSource === "manual") {
    const title = input.manualJobTitle?.trim();

    if (!title) {
      return null;
    }

    return {
      description: "",
      location: null,
      sourceExternalId: `manual:${slugify(title)}`,
      sourceProvider: "manual",
      status: "draft",
      title,
    };
  }

  if (!input.selectedJob) {
    return null;
  }

  return {
    description: "",
    location: input.selectedJob.location ?? null,
    sourceExternalId: input.selectedJob.id,
    sourceProvider: input.jobSource,
    status: "draft",
    title: input.selectedJob.title,
  };
}

function connectionLabel(source: JobSource) {
  if (source === "linkedin") {
    return "LinkedIn mock connector";
  }

  if (source === "indeed") {
    return "Indeed mock connector";
  }

  return "Manual job entry";
}

function mapClerkRole(role: string | null | undefined): OrganizationRole {
  if (!role) {
    return "owner";
  }

  return roleMap[role] ?? "viewer";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
