import type { OrganizationRole } from "@prelude/types";

import {
  canAssignRole,
  canChangeMemberRole,
  canInviteMember,
  canRemoveMember,
} from "../../domain/organization-permissions";
import { getServerT, type ConsoleLocale } from "../../libs/i18n-server";

export type TeamActor = {
  organizationId: string;
  clerkOrganizationId: string | null;
  role: OrganizationRole;
  userId: string;
  // The acting user's UI locale, resolved by the caller (team-actions.ts, via
  // getAuthenticatedUserLocale) and carried on the actor like role/userId so
  // every TeamResult error below can be localized at the point it's raised —
  // same getServerT pattern as user-actions.ts / workspace-settings-actions.ts.
  locale: ConsoleLocale;
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

function requireRealWorkspace(actor: TeamActor): TeamResult<string> {
  if (!actor.clerkOrganizationId) {
    const t = getServerT(actor.locale);
    return { ok: false, error: t("settings.team.mockModeError") };
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
  const t = getServerT(actor.locale);
  if (!canInviteMember(actor.role)) {
    return { ok: false, error: t("settings.team.inviteForbidden") };
  }
  if (!canAssignRole(actor.role, input.role)) {
    return { ok: false, error: t("settings.team.assignRoleForbidden") };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: t("settings.team.invalidEmail") };
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
    const t = getServerT(actor.locale);
    return { ok: false, error: t("settings.team.revokeForbidden") };
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
  const t = getServerT(actor.locale);
  if (input.userId === actor.userId) {
    return { ok: false, error: t("settings.team.cannotChangeOwnRole") };
  }

  const targetRole = await directory.getMemberRole({
    clerkOrganizationId: workspace.value,
    userId: input.userId,
  });
  if (!targetRole) {
    return { ok: false, error: t("settings.team.memberNotFound") };
  }
  if (!canChangeMemberRole(actor.role, targetRole, input.newRole)) {
    return {
      ok: false,
      error: t("settings.team.changeRoleForbidden"),
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
      error: getServerT(actor.locale)("settings.team.cannotRemoveSelf"),
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
      error: getServerT(actor.locale)("settings.team.removeForbidden"),
    };
  }

  await directory.removeMember({
    clerkOrganizationId: workspace.value,
    userId: input.userId,
  });
  return { ok: true, value: null };
}
