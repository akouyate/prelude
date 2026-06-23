import type { OrganizationRole } from "@prelude/types";

import {
  canAssignRole,
  canChangeMemberRole,
  canInviteMember,
  canRemoveMember,
} from "../../domain/organization-permissions";

export type TeamActor = {
  organizationId: string;
  clerkOrganizationId: string | null;
  role: OrganizationRole;
  userId: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: OrganizationRole;
};

/**
 * The subset of Clerk organization-admin operations the team feature needs,
 * injected so the gating/validation can be unit-tested without Clerk. The real
 * adapter maps OrganizationRole to Clerk's role strings.
 */
export interface OrganizationDirectory {
  inviteMember(input: {
    clerkOrganizationId: string;
    email: string;
    role: OrganizationRole;
    inviterUserId: string;
  }): Promise<{ id: string }>;
  listPendingInvitations(
    clerkOrganizationId: string,
  ): Promise<PendingInvitation[]>;
  revokeInvitation(input: {
    clerkOrganizationId: string;
    invitationId: string;
    requesterUserId: string;
  }): Promise<void>;
  getMemberRole(input: {
    clerkOrganizationId: string;
    userId: string;
  }): Promise<OrganizationRole | null>;
  setMemberRole(input: {
    clerkOrganizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<void>;
  removeMember(input: {
    clerkOrganizationId: string;
    userId: string;
  }): Promise<void>;
}

export type TeamResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MOCK_MODE_ERROR =
  "Inviting and managing teammates needs a real workspace, which is not available in local mock mode.";

function requireRealWorkspace(actor: TeamActor): TeamResult<string> {
  if (!actor.clerkOrganizationId) {
    return { ok: false, error: MOCK_MODE_ERROR };
  }
  return { ok: true, value: actor.clerkOrganizationId };
}

export async function inviteTeamMember(
  directory: OrganizationDirectory,
  actor: TeamActor,
  input: { email: string; role: OrganizationRole },
): Promise<TeamResult<{ invitationId: string }>> {
  const workspace = requireRealWorkspace(actor);
  if (!workspace.ok) {
    return workspace;
  }
  if (!canInviteMember(actor.role)) {
    return { ok: false, error: "You do not have permission to invite teammates." };
  }
  if (!canAssignRole(actor.role, input.role)) {
    return { ok: false, error: "You cannot assign that role." };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const invitation = await directory.inviteMember({
    clerkOrganizationId: workspace.value,
    email,
    role: input.role,
    inviterUserId: actor.userId,
  });
  return { ok: true, value: { invitationId: invitation.id } };
}

export async function revokeTeamInvitation(
  directory: OrganizationDirectory,
  actor: TeamActor,
  input: { invitationId: string },
): Promise<TeamResult<null>> {
  const workspace = requireRealWorkspace(actor);
  if (!workspace.ok) {
    return workspace;
  }
  if (!canInviteMember(actor.role)) {
    return { ok: false, error: "You do not have permission to revoke invitations." };
  }
  await directory.revokeInvitation({
    clerkOrganizationId: workspace.value,
    invitationId: input.invitationId,
    requesterUserId: actor.userId,
  });
  return { ok: true, value: null };
}

export async function changeTeamMemberRole(
  directory: OrganizationDirectory,
  actor: TeamActor,
  input: { userId: string; newRole: OrganizationRole },
): Promise<TeamResult<null>> {
  const workspace = requireRealWorkspace(actor);
  if (!workspace.ok) {
    return workspace;
  }
  if (input.userId === actor.userId) {
    return { ok: false, error: "You cannot change your own role." };
  }

  const targetRole = await directory.getMemberRole({
    clerkOrganizationId: workspace.value,
    userId: input.userId,
  });
  if (!targetRole) {
    return { ok: false, error: "That teammate is no longer in the workspace." };
  }
  if (!canChangeMemberRole(actor.role, targetRole, input.newRole)) {
    return {
      ok: false,
      error: "You do not have permission to change this teammate's role.",
    };
  }

  await directory.setMemberRole({
    clerkOrganizationId: workspace.value,
    userId: input.userId,
    role: input.newRole,
  });
  return { ok: true, value: null };
}

export async function removeTeamMember(
  directory: OrganizationDirectory,
  actor: TeamActor,
  input: { userId: string },
): Promise<TeamResult<null>> {
  const workspace = requireRealWorkspace(actor);
  if (!workspace.ok) {
    return workspace;
  }
  if (input.userId === actor.userId) {
    return {
      ok: false,
      error: "You cannot remove yourself from the workspace here.",
    };
  }

  const targetRole = await directory.getMemberRole({
    clerkOrganizationId: workspace.value,
    userId: input.userId,
  });
  if (!targetRole) {
    // Already gone — removal is idempotent.
    return { ok: true, value: null };
  }
  if (!canRemoveMember(actor.role, targetRole)) {
    return {
      ok: false,
      error: "You do not have permission to remove this teammate.",
    };
  }

  await directory.removeMember({
    clerkOrganizationId: workspace.value,
    userId: input.userId,
  });
  return { ok: true, value: null };
}
