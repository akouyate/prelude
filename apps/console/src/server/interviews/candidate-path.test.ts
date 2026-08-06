import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { candidatePathForInterview } from "./interview-loaders";

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 1000);

const invitation = (
  overrides: Partial<{
    candidateEmail: string | null;
    candidateName: string | null;
    expiresAt: Date;
    status: string;
    token: string;
  }> = {},
) => ({
  candidateEmail: null,
  candidateName: null,
  expiresAt: future,
  status: "invited",
  token: "ci_open",
  ...overrides,
});

describe("candidatePathForInterview", () => {
  it("prefers an open, unassigned invitation", () => {
    expect(
      candidatePathForInterview({
        candidateInvitations: [
          invitation({ candidateEmail: "ada@example.com", token: "ci_named" }),
          invitation({ token: "ci_open" }),
        ],
        publicToken: "pub_1",
      }),
    ).toBe("/interview/ci_open");
  });

  it("falls back to an open invitation that is already addressed", () => {
    expect(
      candidatePathForInterview({
        candidateInvitations: [
          invitation({ candidateEmail: "ada@example.com", token: "ci_named" }),
        ],
        publicToken: "pub_1",
      }),
    ).toBe("/interview/ci_named");
  });

  it("never hands out a token the candidate app refuses", () => {
    // A completed, expired or superseded invitation renders "Interview
    // completed" for whoever opens it — including a recruiter previewing.
    for (const status of ["completed", "expired", "superseded"]) {
      expect(
        candidatePathForInterview({
          candidateInvitations: [invitation({ status, token: "ci_dead" })],
          publicToken: "pub_1",
        }),
      ).toBe("/interview/pub_1");
    }

    expect(
      candidatePathForInterview({
        candidateInvitations: [
          invitation({ expiresAt: past, token: "ci_stale" }),
        ],
        publicToken: "pub_1",
      }),
    ).toBe("/interview/pub_1");
  });

  it("uses the public token when there is no invitation at all", () => {
    expect(
      candidatePathForInterview({
        candidateInvitations: [],
        publicToken: "pub_1",
      }),
    ).toBe("/interview/pub_1");
  });
});
