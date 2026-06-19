import "server-only";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@prelude/db";
import { redirect } from "next/navigation";

import { isClerkConfigured } from "../auth/clerk-config";

export async function requireCompletedOrganizationOnboarding() {
  if (!isClerkConfigured) {
    return;
  }

  const authState = await auth();

  if (!authState.userId) {
    return;
  }

  const completedUser = await prisma.user.findFirst({
    select: { id: true },
    where: {
      clerkUserId: authState.userId,
      memberships: {
        some: {
          status: "active",
          organization: {
            ...(authState.orgId
              ? { clerkOrganizationId: authState.orgId }
              : {}),
            onboardingCompletedAt: { not: null },
          },
        },
      },
    },
  });

  if (!completedUser) {
    redirect("/onboarding/organization");
  }
}
