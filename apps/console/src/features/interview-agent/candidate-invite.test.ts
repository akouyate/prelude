import { describe, expect, it } from "vitest";

import { buildCandidateInviteMailto } from "./candidate-invite";

describe("buildCandidateInviteMailto", () => {
  it("builds a mailto link with the encoded subject and body", () => {
    const result = buildCandidateInviteMailto(
      "Interview for Backend Engineer",
      "Join here: https://app.test/interview/iv_abc",
    );

    expect(result.startsWith("mailto:?")).toBe(true);
    expect(result).toContain("subject=Interview%20for%20Backend%20Engineer");
    expect(result).toContain(
      `body=${encodeURIComponent("Join here: https://app.test/interview/iv_abc")}`,
    );
  });

  it("encodes spaces as %20, never + (so mail clients render them)", () => {
    const result = buildCandidateInviteMailto("a b", "c d");

    expect(result).not.toContain("+");
    expect(result).toContain("a%20b");
    expect(result).toContain("c%20d");
  });
});
