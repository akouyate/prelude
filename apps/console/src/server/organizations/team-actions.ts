"use server";

import { revalidatePath } from "next/cache";

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
  return {
    organizationId: scope.organizationId,
    // Mock mode has no real Clerk workspace; null routes the service to its
    // mock-mode guard instead of attempting a Clerk Backend API call.
    clerkOrganizationId:
      session.value.source === "mock"
        ? null
        : session.value.clerkOrganizationId,
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
