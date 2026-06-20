"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma, type PrismaClient } from "@prelude/db";
import {
  organizationOnboardingStateSchema,
  organizationOnboardingStepSchema,
  saveOrganizationOnboardingProgressInputSchema,
  type OrganizationOnboardingJobSource,
  type OrganizationOnboardingState,
  type OrganizationOnboardingStep,
  type SaveOrganizationOnboardingProgressInput,
} from "@prelude/contracts";
import type { OrganizationRole } from "@prelude/types";

import { isClerkConfigured } from "../auth/clerk-config";

type JobSource = OrganizationOnboardingJobSource;

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

type OrganizationOnboardingProgressResult =
  | {
      ok: true;
      completed: boolean;
      currentStep: OrganizationOnboardingStep;
      organizationId: string | null;
      state: OrganizationOnboardingState;
    }
  | {
      ok: false;
      error: string;
    };

type SaveOrganizationOnboardingProgressResult =
  | {
      ok: true;
      currentStep: OrganizationOnboardingStep;
      organizationId: string | null;
      state: OrganizationOnboardingState;
    }
  | {
      ok: false;
      error: string;
    };

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
  "jobSourceConnection" | "organization" | "organizationMembership"
>;

const defaultOnboardingState = organizationOnboardingStateSchema.parse({});

export async function getOrganizationOnboardingProgress(): Promise<OrganizationOnboardingProgressResult> {
  const authContext = await getAuthenticatedOnboardingContext();

  if (!authContext.ok) {
    return authContext;
  }

  const persisted = await findOnboardingOrganizationForUser({
    clerkOrganizationId: authContext.clerkOrganizationId,
    clerkUserId: authContext.userId,
  });

  if (!persisted) {
    return {
      ok: true,
      completed: false,
      currentStep: "welcome",
      organizationId: null,
      state: organizationOnboardingStateSchema.parse({}),
    };
  }

  const state = readPersistedOnboardingState(persisted.organization);
  return {
    ok: true,
    completed: Boolean(persisted.organization.onboardingCompletedAt),
    currentStep: readPersistedOnboardingStep(persisted.organization.onboardingStep),
    organizationId: persisted.organization.id,
    state,
  };
}

export async function saveOrganizationOnboardingProgress(
  input: SaveOrganizationOnboardingProgressInput,
): Promise<SaveOrganizationOnboardingProgressResult> {
  const parsed = saveOrganizationOnboardingProgressInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Onboarding progress is invalid.",
    };
  }

  const authContext = await getAuthenticatedOnboardingContext();

  if (!authContext.ok) {
    return authContext;
  }

  if (!shouldPersistOnboardingState(parsed.data.state)) {
    return {
      ok: true,
      currentStep: parsed.data.currentStep,
      organizationId: null,
      state: parsed.data.state,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await upsertOnboardingUser(tx, authContext);
    const organization = await upsertOnboardingOrganization(
      tx,
      user.id,
      authContext,
      parsed.data,
    );

    await upsertOnboardingMembership(tx, {
      authContext,
      organizationId: organization.id,
      userId: user.id,
      onboardingRole: parsed.data.state.onboardingRole,
    });

    if (shouldApplyProgressSideEffects(parsed.data, organization)) {
      await upsertJobSourceConnection(tx, {
        organizationId: organization.id,
        source: parsed.data.state.jobSource,
      });
    }

    return organization;
  });

  return {
    ok: true,
    currentStep: readPersistedOnboardingStep(result.onboardingStep),
    organizationId: result.id,
    state: readPersistedOnboardingState(result),
  };
}

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
    const user = await upsertOnboardingUser(tx, authContext);

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

    await upsertOnboardingMembership(tx, {
      authContext,
      organizationId: organization.id,
      onboardingRole: input.onboardingRole,
      userId: user.id,
    });

    await upsertJobSourceConnection(tx, {
      organizationId: organization.id,
      source: input.jobSource,
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
    redirectTo: "/",
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
  const state = toOnboardingState(input);

  return {
    companySize: input.companySize,
    defaultInterviewMode: input.interviewMode,
    hiringFocus: input.hiringFocus,
    name: input.companyName.trim(),
    onboardingCompletedAt: new Date(),
    onboardingState: state,
    onboardingStep: "ready",
  };
}

async function upsertOnboardingUser(
  tx: Pick<PrismaClient, "user">,
  authContext: Extract<
    Awaited<ReturnType<typeof getAuthenticatedOnboardingContext>>,
    { ok: true }
  >,
) {
  return tx.user.upsert({
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
}

async function upsertOnboardingMembership(
  tx: Pick<PrismaClient, "organizationMembership">,
  input: {
    authContext: Extract<
      Awaited<ReturnType<typeof getAuthenticatedOnboardingContext>>,
      { ok: true }
    >;
    organizationId: string;
    onboardingRole: string;
    userId: string;
  },
) {
  return tx.organizationMembership.upsert({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    update: {
      onboardingRole: input.onboardingRole || null,
      role: input.authContext.role,
      status: "active",
    },
    create: {
      organizationId: input.organizationId,
      onboardingRole: input.onboardingRole || null,
      role: input.authContext.role,
      status: "active",
      userId: input.userId,
    },
  });
}

async function upsertOnboardingOrganization(
  tx: OnboardingTransaction,
  userId: string,
  authContext: Extract<
    Awaited<ReturnType<typeof getAuthenticatedOnboardingContext>>,
    { ok: true }
  >,
  input: SaveOrganizationOnboardingProgressInput,
) {
  const data = organizationProgressData(input);

  if (authContext.clerkOrganizationId) {
    const existingOrganization = await tx.organization.findUnique({
      where: { clerkOrganizationId: authContext.clerkOrganizationId },
    });

    if (existingOrganization) {
      if (shouldSkipProgressUpdate(input, existingOrganization)) {
        return existingOrganization;
      }

      return tx.organization.update({
        where: { id: existingOrganization.id },
        data,
      });
    }

    return tx.organization.create({
      data: {
        clerkOrganizationId: authContext.clerkOrganizationId,
        ...data,
      },
    });
  }

  const existingMembership = await tx.organizationMembership.findFirst({
    include: { organization: true },
    orderBy: { createdAt: "asc" },
    where: {
      status: "active",
      userId,
    },
  });

  if (existingMembership) {
    if (shouldSkipProgressUpdate(input, existingMembership.organization)) {
      return existingMembership.organization;
    }

    return tx.organization.update({
      where: { id: existingMembership.organizationId },
      data,
    });
  }

  return tx.organization.create({
    data,
  });
}

function organizationProgressData(
  input: SaveOrganizationOnboardingProgressInput,
) {
  return {
    companySize: input.state.companySize || null,
    defaultInterviewMode: input.state.interviewMode || null,
    hiringFocus: input.state.hiringFocus || null,
    name: input.state.companyName || "Untitled workspace",
    onboardingState: {
      ...input.state,
      progressRevision: input.clientRevision,
    },
    onboardingStep: input.currentStep,
  };
}

async function upsertJobSourceConnection(
  tx: Pick<PrismaClient, "jobSourceConnection">,
  input: {
    organizationId: string;
    source: JobSource | "";
  },
) {
  if (!input.source) {
    return null;
  }

  const status = input.source === "manual" ? "manual" : "mock_connected";

  return tx.jobSourceConnection.upsert({
    where: {
      organizationId_provider: {
        organizationId: input.organizationId,
        provider: input.source,
      },
    },
    update: {
      externalLabel: connectionLabel(input.source),
      status,
    },
    create: {
      externalLabel: connectionLabel(input.source),
      organizationId: input.organizationId,
      provider: input.source,
      status,
    },
  });
}

async function findOnboardingOrganizationForUser({
  clerkOrganizationId,
  clerkUserId,
}: {
  clerkOrganizationId: string | null;
  clerkUserId: string;
}) {
  return prisma.organizationMembership.findFirst({
    include: {
      organization: true,
    },
    orderBy: { createdAt: "asc" },
    where: {
      status: "active",
      user: {
        clerkUserId,
      },
      ...(clerkOrganizationId
        ? {
            organization: {
              clerkOrganizationId,
            },
          }
        : {}),
    },
  });
}

function readPersistedOnboardingState(input: {
  companySize: string | null;
  defaultInterviewMode: string | null;
  hiringFocus: string | null;
  name: string;
  onboardingState: unknown;
}) {
  const parsed = organizationOnboardingStateSchema.safeParse(
    input.onboardingState,
  );
  const state = parsed.success ? parsed.data : defaultOnboardingState;

  return organizationOnboardingStateSchema.parse({
    ...state,
    companyName:
      state.companyName ||
      (input.name === "Untitled workspace" ? "" : input.name),
    companySize: state.companySize || input.companySize || "",
    hiringFocus: state.hiringFocus || input.hiringFocus || "",
    interviewMode:
      state.interviewMode ||
      input.defaultInterviewMode ||
      defaultOnboardingState.interviewMode,
  });
}

function readPersistedOnboardingStep(
  step: string | null | undefined,
): OrganizationOnboardingStep {
  const parsed = organizationOnboardingStepSchema.safeParse(step);

  return parsed.success ? parsed.data : "welcome";
}

function shouldPersistOnboardingState(state: OrganizationOnboardingState) {
  return (
    state.companyName.trim().length >= 2 ||
    Boolean(
      state.companySize ||
        state.hiringFocus ||
        state.jobSource ||
        state.manualJobTitle ||
        state.onboardingRole ||
        state.selectedJobId,
    )
  );
}

function shouldSkipProgressUpdate(
  input: SaveOrganizationOnboardingProgressInput,
  organization: {
    onboardingCompletedAt: Date | null;
    onboardingState: unknown;
  },
) {
  if (organization.onboardingCompletedAt) {
    return true;
  }

  return input.clientRevision < readPersistedProgressRevision(organization);
}

function shouldApplyProgressSideEffects(
  input: SaveOrganizationOnboardingProgressInput,
  organization: {
    onboardingCompletedAt: Date | null;
    onboardingState: unknown;
  },
) {
  if (organization.onboardingCompletedAt) {
    return false;
  }

  return input.clientRevision >= readPersistedProgressRevision(organization);
}

function readPersistedProgressRevision(input: { onboardingState: unknown }) {
  if (!input.onboardingState || typeof input.onboardingState !== "object") {
    return 0;
  }

  const revision = (input.onboardingState as { progressRevision?: unknown })
    .progressRevision;

  return typeof revision === "number" && Number.isInteger(revision) && revision >= 0
    ? revision
    : 0;
}

function toOnboardingState(
  input: CompleteOrganizationOnboardingInput,
): OrganizationOnboardingState {
  return organizationOnboardingStateSchema.parse({
    companyName: input.companyName,
    companySize: input.companySize,
    hiringFocus: input.hiringFocus,
    interviewMode: input.interviewMode,
    jobSource: input.jobSource,
    manualJobTitle: input.manualJobTitle ?? "",
    onboardingRole: input.onboardingRole,
    selectedJobId: input.selectedJob?.id ?? "",
  });
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
