import { afterEach, describe, expect, it, vi } from "vitest";

import {
  candidateAppOrigin,
  candidateAppUrl,
  candidateLinkLabel,
} from "./candidate-app-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("candidate app url", () => {
  it("points candidate links at the candidate app, not the console", () => {
    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "https://candidate.hirecall.test");

    expect(candidateAppUrl("/interview/ci_abc")).toBe(
      "https://candidate.hirecall.test/interview/ci_abc",
    );
  });

  it("keeps only the origin when the configured value carries a path", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_CANDIDATE_URL",
      "https://candidate.hirecall.test/ignored",
    );

    expect(candidateAppOrigin()).toBe("https://candidate.hirecall.test");
  });

  it("falls back to the local candidate port when unset or unusable", () => {
    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "");
    expect(candidateAppOrigin()).toBe("http://localhost:3001");

    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "not-a-url");
    expect(candidateAppOrigin()).toBe("http://localhost:3001");

    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "ftp://candidate.hirecall.test");
    expect(candidateAppOrigin()).toBe("http://localhost:3001");
  });

  it("labels a candidate link with the host, without the scheme", () => {
    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "https://candidate.hirecall.test");

    expect(candidateLinkLabel("/interview/ci_abc")).toBe(
      "candidate.hirecall.test/interview/ci_abc",
    );
  });
});
