import { describe, expect, it } from "vitest";

import {
  resolveInterviewLanguage,
  resolveWorkspaceLanguage,
} from "./content-language";

// Junk is pinned deliberately: these two read PERSISTED values (a nullable
// `InterviewDraft.language` column, a free-form `Organization.settings` JSON
// key), so they must survive legacy casing and rows written before the columns
// existed. Case folds; anything outside the en/fr catalogue pair falls through
// to the next fallback rather than being guessed at.
const JUNK = ["de", "en-US", "", "   ", "null"] as const;

describe("resolveInterviewLanguage", () => {
  it.each(["en", "fr"] as const)(
    "prefers the draft's own %s over the workspace interview default",
    (language) => {
      const other = language === "en" ? "fr" : "en";

      expect(resolveInterviewLanguage(language, other)).toBe(language);
    },
  );

  it.each(["FR", " Fr ", "EN"])("folds the draft's casing on %j", (value) => {
    expect(resolveInterviewLanguage(value, "en")).toBe(
      value.trim().toLowerCase(),
    );
  });

  it.each([null, undefined])(
    "falls back to the workspace interview default when the draft language is %j",
    (draftLanguage) => {
      expect(resolveInterviewLanguage(draftLanguage, "fr")).toBe("fr");
    },
  );

  it.each(JUNK)(
    "ignores the unknown draft language %j and uses the interview default",
    (draftLanguage) => {
      expect(resolveInterviewLanguage(draftLanguage, "fr")).toBe("fr");
    },
  );

  it.each(JUNK)(
    "falls all the way back to English when the interview default is %j too",
    (orgDefault) => {
      expect(resolveInterviewLanguage(null, orgDefault)).toBe("en");
    },
  );

  it("folds the interview default's casing", () => {
    expect(resolveInterviewLanguage(null, "FR")).toBe("fr");
  });

  it("resolves English when neither side says anything", () => {
    expect(resolveInterviewLanguage(null, null)).toBe("en");
    expect(resolveInterviewLanguage(undefined, undefined)).toBe("en");
  });
});

describe("resolveWorkspaceLanguage", () => {
  it.each(["en", "fr"] as const)("keeps a valid %s", (language) => {
    expect(resolveWorkspaceLanguage(language)).toBe(language);
  });

  it.each(["FR", " fr ", "EN"])("folds the casing on %j", (value) => {
    expect(resolveWorkspaceLanguage(value)).toBe(value.trim().toLowerCase());
  });

  it.each([...JUNK, null, undefined])(
    "defaults to English for %j",
    (value) => {
      expect(resolveWorkspaceLanguage(value)).toBe("en");
    },
  );
});
