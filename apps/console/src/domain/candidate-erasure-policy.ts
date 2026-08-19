import { type OrganizationRole } from "@prelude/types";

// canEraseCandidateData gates the recruiter-facing right-to-erasure action.
//
// It is the same owner/admin bar as `canDeleteRecording`, and deliberately its
// own predicate rather than a reuse: deleting a recording removes one artefact,
// whereas this destroys the interview transcript, the generated brief and the
// candidate's identity in one irreversible act. If one of the two bars ever
// moves, it must be able to move without dragging the other with it.
export function canEraseCandidateData(role: OrganizationRole) {
  return role === "owner" || role === "admin";
}
