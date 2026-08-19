import { describe, expect, it } from "vitest";

import { resolveCandidateRenderingLanguage } from "./interview-language";

describe("resolveCandidateRenderingLanguage", () => {
  it("keeps a stamped catalogue language", () => {
    expect(resolveCandidateRenderingLanguage("en")).toBe("en");
    expect(resolveCandidateRenderingLanguage("fr")).toBe("fr");
  });

  it("case-folds and trims what the snapshot stored", () => {
    expect(resolveCandidateRenderingLanguage("EN")).toBe("en");
    expect(resolveCandidateRenderingLanguage(" Fr ")).toBe("fr");
  });

  it("falls back to French for a legacy or missing stamp", () => {
    // Mirrors the Go realtime store: an unstamped snapshot runs a French
    // interview, so the consent has to be French too.
    expect(resolveCandidateRenderingLanguage(null)).toBe("fr");
    expect(resolveCandidateRenderingLanguage(undefined)).toBe("fr");
    expect(resolveCandidateRenderingLanguage("")).toBe("fr");
    expect(resolveCandidateRenderingLanguage("   ")).toBe("fr");
  });

  it("falls back to French for a language outside the catalogue pair", () => {
    expect(resolveCandidateRenderingLanguage("de")).toBe("fr");
    expect(resolveCandidateRenderingLanguage("en-US")).toBe("fr");
    expect(resolveCandidateRenderingLanguage("english")).toBe("fr");
  });
});
