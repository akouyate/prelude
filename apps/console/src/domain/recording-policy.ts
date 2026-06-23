import { type OrganizationRole } from "@prelude/types";

// canDeleteRecording gates the right-to-erasure action. Erasing a candidate's
// voice recording is destructive and irreversible, so it is restricted to owners
// and admins — stricter than review management, which recruiters may also do.
export function canDeleteRecording(role: OrganizationRole) {
  return role === "owner" || role === "admin";
}
