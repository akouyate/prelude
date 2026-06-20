import "server-only";

import { prisma } from "@prelude/db";
import { redirect } from "next/navigation";

import { getConsoleAuthSession } from "../auth/console-auth-provider";

export async function requireCompletedOrganizationOnboarding() {
  const authSession = await getConsoleAuthSession();

  if (!authSession.ok) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(authSession.error);
    }

    return;
  }

  if (authSession.value.source === "mock") {
    return;
  }

  const completedUser = await prisma.user.findFirst({
    select: { id: true },
    where: {
      clerkUserId: authSession.value.userId,
      memberships: {
        some: {
          status: "active",
          organization: {
            ...(authSession.value.clerkOrganizationId
              ? { clerkOrganizationId: authSession.value.clerkOrganizationId }
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
