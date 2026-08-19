import { describe, expect, it } from "vitest";

import {
  resolveBriefLanguageBadge,
  resolveQuoteLanguageNote,
} from "./candidate-review-model";

// The badge is an honesty signal, not decoration: it fires only when the brief
// is NOT in the language this workspace reads (plan 2026-08-18, rule 6).
describe("resolveBriefLanguageBadge", () => {
  it("shows nothing when the brief matches the workspace language", () => {
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: "fr",
        workspaceLanguage: "fr",
      }),
    ).toBeNull();
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: "en",
        workspaceLanguage: "en",
      }),
    ).toBeNull();
  });

  it("tolerates a legacy casing or padded stamp as a match", () => {
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: " FR ",
        workspaceLanguage: "fr",
      }),
    ).toBeNull();
  });

  it("names the language when the brief disagrees with the workspace", () => {
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: "en",
        workspaceLanguage: "fr",
      }),
    ).toEqual({ kind: "other", language: "en" });
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: "fr",
        workspaceLanguage: "en",
      }),
    ).toEqual({ kind: "other", language: "fr" });
  });

  // Since the generation fix, a null stamp means one thing only: the brief was
  // generated before stamping existed. Never backfilled, so never guessed at.
  it("reports an unstamped brief as unknown rather than assuming the workspace language", () => {
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: null,
        workspaceLanguage: "en",
      }),
    ).toEqual({ kind: "unknown" });
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: "   ",
        workspaceLanguage: "fr",
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("keeps an out-of-catalogue stamp visible instead of swallowing it", () => {
    expect(
      resolveBriefLanguageBadge({
        briefLanguage: "de",
        workspaceLanguage: "en",
      }),
    ).toEqual({ kind: "other", language: "de" });
  });
});

// A French workspace may screen a candidate in English (the builder's per-draft
// language selector). The brief is then written in French while the evidence
// blockquotes stay verbatim English (plan 2026-08-18, rule 4) — which reads like
// a translation bug, or worse, gets misread as weak communication. This note is
// the explanation. It keys off the INTERVIEW language, never the brief's.
describe("resolveQuoteLanguageNote", () => {
  it("says nothing when the interview was conducted in the workspace language", () => {
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: "fr",
        workspaceLanguage: "fr",
      }),
    ).toBeNull();
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: " EN ",
        workspaceLanguage: "en",
      }),
    ).toBeNull();
  });

  it("names the interview language when it differs from the workspace", () => {
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: "en",
        workspaceLanguage: "fr",
      }),
    ).toEqual({ language: "en" });
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: "fr",
        workspaceLanguage: "en",
      }),
    ).toEqual({ language: "fr" });
  });

  // An unstamped interview cannot support a claim about what the quotes are in,
  // so it says nothing rather than guessing at the candidate's language.
  it("says nothing when the interview language is unknown", () => {
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: null,
        workspaceLanguage: "fr",
      }),
    ).toBeNull();
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: "   ",
        workspaceLanguage: "en",
      }),
    ).toBeNull();
  });

  it("keeps an out-of-catalogue interview language visible", () => {
    expect(
      resolveQuoteLanguageNote({
        interviewLanguage: "de",
        workspaceLanguage: "en",
      }),
    ).toEqual({ language: "de" });
  });
});
