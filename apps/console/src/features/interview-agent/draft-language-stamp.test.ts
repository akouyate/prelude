import { describe, expect, it } from "vitest";

import { draftLanguagePatch } from "./draft-language-stamp";

// Plan 2026-08-18, rule 6: `InterviewDraft.language` is null for everything
// generated before stamping existed, and is NEVER backfilled. The builder shows
// a concrete language regardless (the selector has to render on something), so
// the guard lives here — between what is displayed and what is saved.
describe("draft language save payload", () => {
  const base = {
    hasPersistedDraft: true,
    hasPersistedLanguage: false,
    language: "en" as const,
    languageTouched: false,
  };

  it("omits the language for a legacy draft on a plain save", () => {
    expect(draftLanguagePatch(base)).toEqual({});
  });

  it("omits it even when the displayed value came from the workspace default", () => {
    // The exact backfill this guards against: the org default is French today,
    // the draft was generated in English before stamping existed, and an
    // autosave would have relabelled it "fr".
    expect(draftLanguagePatch({ ...base, language: "fr" })).toEqual({});
  });

  it("sends it once the recruiter moves the selector", () => {
    expect(
      draftLanguagePatch({ ...base, language: "fr", languageTouched: true }),
    ).toEqual({ language: "fr" });
  });

  it("sends it for a draft that already carries a stamp", () => {
    expect(
      draftLanguagePatch({ ...base, hasPersistedLanguage: true })
    ).toEqual({ language: "en" });
  });

  it("sends it when the draft has never been persisted", () => {
    // Creation is exactly when the stamp is supposed to be written.
    expect(
      draftLanguagePatch({ ...base, hasPersistedDraft: false, language: "fr" }),
    ).toEqual({ language: "fr" });
  });

  it("never emits a null or undefined language key", () => {
    for (const patch of [
      draftLanguagePatch(base),
      draftLanguagePatch({ ...base, languageTouched: true }),
    ]) {
      expect(Object.values(patch).every(Boolean)).toBe(true);
    }
  });
});
