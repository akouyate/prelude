import { organizationRoles, type OrganizationRole } from "@prelude/types";

import { mapClerkOrganizationRole } from "./organization-access-policy";

// The granular Prelude roles we recognise, derived from the canonical list so a
// new role in @prelude/types is accepted here automatically. The role is carried
// in Clerk publicMetadata (plan-independent — no custom-roles add-on required);
// Clerk's own role stays the coarse org:admin / org:member.
const VALID_ROLES: ReadonlySet<string> = new Set<OrganizationRole>(
  organizationRoles,
);

// The publicMetadata key the granular role travels under, plus its reader/writer
// — shared by the Clerk directory (outbound) and the webhook sync (inbound) so
// the key lives in one place.
export function readPreludeRole(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "preludeRole" in metadata) {
    const value = (metadata as Record<string, unknown>).preludeRole;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function preludeRoleMetadata(role: OrganizationRole): {
  preludeRole: OrganizationRole;
} {
  return { preludeRole: role };
}

/**
 * Resolve our authoritative OrganizationRole from a Clerk membership/invitation:
 * prefer the granular role carried in publicMetadata, otherwise fall back to the
 * Clerk coarse role (org:admin -> admin, org:member -> recruiter), otherwise the
 * least-privilege viewer.
 */
export function resolveOrganizationRoleFromClerk(input: {
  publicMetadataRole?: string | null;
  clerkRole?: string | null;
}): OrganizationRole {
  const granular = input.publicMetadataRole?.trim().toLowerCase();
  if (granular && VALID_ROLES.has(granular)) {
    return granular as OrganizationRole;
  }

  return mapClerkOrganizationRole(input.clerkRole, "viewer");
}

/**
 * Map our granular OrganizationRole to Clerk's coarse membership role. Clerk's
 * default Role Set only distinguishes admin vs member (custom roles need the
 * paid B2B add-on), so owner/admin -> org:admin and recruiter/viewer ->
 * org:member; the granular role is carried alongside in publicMetadata.
 */
export function toClerkMembershipRole(
  role: OrganizationRole,
): "org:admin" | "org:member" {
  return role === "owner" || role === "admin" ? "org:admin" : "org:member";
}
