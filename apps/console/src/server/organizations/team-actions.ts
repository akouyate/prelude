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
  type OrganizationDirectory,
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
  // clerkOrganizationId comes from the org scope (null in mock mode), so the
  // service's mock-mode guard fires without a per-action source check.
  return {
    organizationId: scope.organizationId,
    clerkOrganizationId: scope.clerkOrganizationId,
    role: scope.role,
    userId: session.value.userId,
  };
}

// Every team action shares one envelope: resolve the actor, delegate to the
// gated service with the live Clerk directory, and revalidate settings on
// success.
async function runTeamAction<Input, Value>(
  serviceFn: (
    directory: OrganizationDirectory,
    actor: TeamActor,
    input: Input,
  ) => Promise<TeamResult<Value>>,
  input: Input,
): Promise<TeamResult<Value>> {
  const actor = await getTeamActor();
  const result = await serviceFn(clerkOrganizationDirectory, actor, input);
  if (result.ok) {
    revalidatePath(SETTINGS_PATH);
  }
  return result;
}

export async function inviteTeamMemberAction(input: {
  email: string;
  role: OrganizationRole;
}) {
  return runTeamAction(inviteTeamMember, input);
}

export async function revokeTeamInvitationAction(input: {
  invitationId: string;
}) {
  return runTeamAction(revokeTeamInvitation, input);
}

export async function changeTeamMemberRoleAction(input: {
  userId: string;
  newRole: OrganizationRole;
}) {
  return runTeamAction(changeTeamMemberRole, input);
}

export async function removeTeamMemberAction(input: { userId: string }) {
  return runTeamAction(removeTeamMember, input);
}
