import type { OrganizationRole } from "@prelude/types";

// Workspace team-management permissions (the "Standard" matrix): owner + admin
// manage the team (invite / change roles / remove). Guardrails: an admin can
// never act on an owner, and only an owner can grant the owner role (ownership
// transfer).

const TEAM_MANAGER_ROLES: ReadonlySet<OrganizationRole> = new Set<OrganizationRole>([
  "owner",
  "admin",
]);
const ROLE_MANAGER_ROLES: ReadonlySet<OrganizationRole> = new Set<OrganizationRole>([
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

export function canManageRoles(role: OrganizationRole): boolean {
  return ROLE_MANAGER_ROLES.has(role);
}

/**
 * Whether `role` may spend the organization's money on interview credits (#140).
 *
 * Deliberately delegates to `canManageTeam` rather than declaring its own set: a
 * second, drifting definition of "manager" is how permission bugs are born, and
 * this is the same owner/admin line the dispute notification and the team
 * controls already draw. It is named separately because the *reason* differs —
 * committing the company to a €2,790 charge, not administering members — so the
 * day the two diverge, this is the one line that changes.
 *
 * Reading the wallet is NOT gated: a recruiter needs to know whether an interview
 * can run before inviting a candidate.
 */
export function canPurchaseCredits(role: OrganizationRole): boolean {
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
