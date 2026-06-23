import type { OrganizationRole } from "@prelude/types";

// The "Standard" workspace permission matrix:
// - owner + admin: manage the team (invite / change roles / remove), publish,
//   and override compliance.
// - recruiter: create/edit/publish roles and review candidates, but no team
//   management.
// - viewer: read-only.
// Guardrails on top: an admin can never act on an owner, and only an owner can
// grant the owner role (ownership transfer).

const TEAM_MANAGER_ROLES: ReadonlySet<OrganizationRole> = new Set<OrganizationRole>([
  "owner",
  "admin",
]);

const CONTENT_ROLES: ReadonlySet<OrganizationRole> = new Set<OrganizationRole>([
  "owner",
  "admin",
  "recruiter",
]);

// Roles a manager can pick from a normal role dropdown. Granting `owner` is an
// explicit ownership transfer (owner-only), not a dropdown choice.
export const ASSIGNABLE_ROLE_OPTIONS: readonly OrganizationRole[] = [
  "admin",
  "recruiter",
  "viewer",
];

export function canManageTeam(role: OrganizationRole): boolean {
  return TEAM_MANAGER_ROLES.has(role);
}

export function canInviteMember(role: OrganizationRole): boolean {
  return canManageTeam(role);
}

/**
 * Whether `actorRole` may act on a member who currently holds `targetRole`.
 * An owner can act on anyone; an admin can act on anyone except an owner.
 */
export function canManageMember(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
): boolean {
  if (!canManageTeam(actorRole)) {
    return false;
  }
  if (actorRole === "owner") {
    return true;
  }
  // admin
  return targetRole !== "owner";
}

/**
 * Whether `actorRole` may assign `newRole` to someone. Only an owner can grant
 * the owner role.
 */
export function canAssignRole(
  actorRole: OrganizationRole,
  newRole: OrganizationRole,
): boolean {
  if (!canManageTeam(actorRole)) {
    return false;
  }
  if (newRole === "owner") {
    return actorRole === "owner";
  }
  return true;
}

export function canChangeMemberRole(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
  newRole: OrganizationRole,
): boolean {
  return (
    canManageMember(actorRole, targetRole) && canAssignRole(actorRole, newRole)
  );
}

export function canRemoveMember(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
): boolean {
  return canManageMember(actorRole, targetRole);
}

export function canManageContent(role: OrganizationRole): boolean {
  return CONTENT_ROLES.has(role);
}

export function canReviewCandidates(role: OrganizationRole): boolean {
  return CONTENT_ROLES.has(role);
}

export function canOverrideCompliance(role: OrganizationRole): boolean {
  return TEAM_MANAGER_ROLES.has(role);
}

export function isReadOnlyRole(role: OrganizationRole): boolean {
  return role === "viewer";
}
