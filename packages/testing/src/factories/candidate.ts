import type { Candidate } from "@prelude/types";

export function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "candidate_1",
    fullName: "Camille Martin",
    email: "camille@example.com",
    status: "to_review",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}
