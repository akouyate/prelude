import { describe, expect, it } from "vitest";

import {
  hasCandidateInvitationErrors,
  MAX_CANDIDATE_INVITATION_DAYS,
  MAX_CANDIDATE_NAME_CHARACTERS,
  validateCandidateInvitation,
} from "./candidate-invitation-policy";

const now = new Date("2026-08-05T12:00:00.000Z");

function validate(input: Partial<Parameters<typeof validateCandidateInvitation>[0]>) {
  return validateCandidateInvitation(
    { candidateEmail: "", candidateName: "", expiresAt: "", ...input },
    now,
  );
}

describe("validateCandidateInvitation", () => {
  // Both fields are optional: the recruiter can create a link and share it
  // themselves without ever naming the candidate.
  it("accepts an entirely empty invitation", () => {
    expect(validate({})).toEqual({});
    expect(hasCandidateInvitationErrors(validate({}))).toBe(false);
  });

  it.each([
    "ada@example.com",
    "  ADA.Martin+jobs@sub.example.co.uk  ",
    "a@b.io",
  ])("accepts a usable email: %s", (candidateEmail) => {
    expect(validate({ candidateEmail }).candidateEmail).toBeUndefined();
  });

  it.each([
    "xzdzdz asa",
    "ada",
    "ada@",
    "@example.com",
    "ada@example",
    "ada @example.com",
  ])("rejects an unusable email: %s", (candidateEmail) => {
    expect(validate({ candidateEmail }).candidateEmail).toBeTruthy();
  });

  it("rejects a candidate name beyond the stored length", () => {
    expect(
      validate({ candidateName: "a".repeat(MAX_CANDIDATE_NAME_CHARACTERS) })
        .candidateName,
    ).toBeUndefined();
    expect(
      validate({ candidateName: "a".repeat(MAX_CANDIDATE_NAME_CHARACTERS + 1) })
        .candidateName,
    ).toBeTruthy();
  });

  // An expiry in the past would create a link that is dead on arrival.
  it("rejects an expiry that is not in the future", () => {
    expect(validate({ expiresAt: "2026-08-04" }).expiresAt).toBeTruthy();
    expect(validate({ expiresAt: "2026-08-06" }).expiresAt).toBeUndefined();
  });

  it("rejects an expiry beyond the retention horizon", () => {
    const withinHorizon = new Date(now);
    withinHorizon.setDate(withinHorizon.getDate() + MAX_CANDIDATE_INVITATION_DAYS - 1);
    const beyondHorizon = new Date(now);
    beyondHorizon.setDate(beyondHorizon.getDate() + MAX_CANDIDATE_INVITATION_DAYS + 1);

    expect(
      validate({ expiresAt: withinHorizon.toISOString().slice(0, 10) }).expiresAt,
    ).toBeUndefined();
    expect(
      validate({ expiresAt: beyondHorizon.toISOString().slice(0, 10) }).expiresAt,
    ).toBeTruthy();
  });

  it("rejects an unparseable expiry", () => {
    expect(validate({ expiresAt: "not-a-date" }).expiresAt).toBeTruthy();
  });

  it("reports every offending field at once", () => {
    const errors = validate({
      candidateEmail: "nope",
      candidateName: "a".repeat(MAX_CANDIDATE_NAME_CHARACTERS + 1),
      expiresAt: "2020-01-01",
    });

    expect(Object.keys(errors).sort()).toEqual([
      "candidateEmail",
      "candidateName",
      "expiresAt",
    ]);
  });
});
