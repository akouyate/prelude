"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@prelude/db";
import type { OrganizationRole } from "@prelude/types";

import { getConsoleAuthSession } from "../auth/console-auth-provider";
import { clerkOrganizationDirectory } from "./clerk-organization-directory";
import { getCompletedOrganizationScope } from "./organization-scope";
import {
  changeTeamMemberRole,
  inviteTeamMember,
  removeTeamMember,
  revokeTeamInvitation,
  type TeamActor,
  type TeamResult,
} from "./team-management";

const SETTINGS_PATH = "/settings";

async function getTeamActor(): Promise<TeamActor> {
  const [scope, session] = await Promise.all([
    getCompletedOrganizationScope(),
    getConsoleAuthSession(),
  ]);
  if (!session.ok) {
    throw new Error(session.error);
  }
  // Resolve the Clerk org id from the user's DB organization (consistent with
  // how the rest of the console scopes data) rather than the session's active
  // org, which can be unset on a fresh sign-in. Mock mode has no Clerk org, so
  // null routes the service to its mock-mode guard.
  const clerkOrganizationId =
    session.value.source === "mock"
      ? null
      : ((
          await prisma.organization.findUnique({
            select: { clerkOrganizationId: true },
            where: { id: scope.organizationId },
          })
        )?.clerkOrganizationId ?? null);

  return {
    organizationId: scope.organizationId,
    clerkOrganizationId,
    role: scope.role,
    userId: session.value.userId,
  };
}

export async function inviteTeamMemberAction(input: {
  email: string;
  role: OrganizationRole;
}): Promise<TeamResult<{ invitationId: string }>> {
  const actor = await getTeamActor();
  const result = await inviteTeamMember(
    clerkOrganizationDirectory,
    actor,
    input,
  );
  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }
  return result;
}

export async function revokeTeamInvitationAction(input: {
  invitationId: string;
}): Promise<TeamResult<null>> {
  const actor = await getTeamActor();
  const result = await revokeTeamInvitation(
    clerkOrganizationDirectory,
    actor,
    input,
  );
  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }
  return result;
}

export async function changeTeamMemberRoleAction(input: {
  userId: string;
  newRole: OrganizationRole;
}): Promise<TeamResult<null>> {
  const actor = await getTeamActor();
  const result = await changeTeamMemberRole(
    clerkOrganizationDirectory,
    actor,
    input,
  );
  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }
  return result;
}

export async function removeTeamMemberAction(input: {
  userId: string;
}): Promise<TeamResult<null>> {
  const actor = await getTeamActor();
  const result = await removeTeamMember(
    clerkOrganizationDirectory,
    actor,
    input,
  );
  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }
  return result;
}
