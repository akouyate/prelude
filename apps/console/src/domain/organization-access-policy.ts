import type { OrganizationRole } from "@prelude/types";

const clerkRoleMap: Record<string, OrganizationRole> = {
  "org:admin": "admin",
  "org:member": "recruiter",
  admin: "admin",
  member: "recruiter",
  owner: "owner",
  recruiter: "recruiter",
  viewer: "viewer",
};

export function mapClerkOrganizationRole(
  role: string | null | undefined,
  fallback: OrganizationRole,
): OrganizationRole {
  if (!role) {
    return fallback;
  }

  return clerkRoleMap[role] ?? "viewer";
}
