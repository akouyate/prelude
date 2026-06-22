import { describe, expect, it, vi } from "vitest";

import { protectedTopicCategories } from "@prelude/core";

// `i18n-server` carries the `server-only` import guard; stub it like the other
// server-side unit tests so the pure translation logic can be exercised here.
vi.mock("server-only", () => ({}));

import {
  consoleLocales,
  coerceConsoleLocale,
  getServerT,
  type ConsoleLocale,
} from "./i18n-server";

// Re-expresses the retired N6c `compliance-copy` assertions against the
// /public/locales catalogs that now own the recruiter-facing copy. The default
// locale is "en" and its strings stay byte-identical to the previous hardcoded
// English so behavior is preserved.

describe("coerceConsoleLocale", () => {
  it("defaults to 'en' for anything other than 'fr'", () => {
    expect(coerceConsoleLocale(undefined)).toBe("en");
    expect(coerceConsoleLocale(null)).toBe("en");
    expect(coerceConsoleLocale("")).toBe("en");
    expect(coerceConsoleLocale("de")).toBe("en");
    expect(coerceConsoleLocale("EN")).toBe("en");
    expect(coerceConsoleLocale("en")).toBe("en");
  });

  it("returns 'fr' for 'fr'", () => {
    expect(coerceConsoleLocale("fr")).toBe("fr");
  });

  it("exposes the supported locale list", () => {
    expect(consoleLocales).toEqual(["en", "fr"]);
  });
});

describe("category labels", () => {
  const locales: ConsoleLocale[] = ["en", "fr"];

  it("returns a non-empty label for every protected-topic category in every locale", () => {
    for (const locale of locales) {
      const t = getServerT(locale);
      for (const category of protectedTopicCategories) {
        const label = t(`category.${category}`);
        expect(typeof label).toBe("string");
        expect(label.trim().length).toBeGreaterThan(0);
        // The key itself must not leak through (i18next returns the key on miss).
        expect(label).not.toBe(`category.${category}`);
      }
    }
  });

  it("never leaks a raw snake_case enum token as a label", () => {
    for (const locale of locales) {
      const t = getServerT(locale);
      for (const category of protectedTopicCategories) {
        expect(t(`category.${category}`)).not.toContain("_");
      }
    }
  });

  it("uses friendly EN labels for representative categories", () => {
    const t = getServerT("en");
    expect(t("category.union_or_political_activity")).toBe(
      "Union or political activity",
    );
    expect(t("category.automated_decision")).toBe("Automated decision");
    expect(t("category.protected_topic")).toBe("Protected topic");
    expect(t("category.age")).toBe("Age");
  });

  it("uses friendly FR labels for representative categories", () => {
    const t = getServerT("fr");
    expect(t("category.union_or_political_activity")).toBe(
      "Activité syndicale ou engagement politique",
    );
    expect(t("category.automated_decision")).toBe("Décision automatisée");
    expect(t("category.protected_topic")).toBe("Sujet protégé");
    expect(t("category.age")).toBe("Âge");
  });
});

describe("compliance messages", () => {
  it("returns the exact current English block message", () => {
    expect(getServerT("en")("compliance.planDisallowedTopicBlock")).toBe(
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    );
  });

  it("returns the exact current English question warning", () => {
    expect(getServerT("en")("compliance.questionWarning")).toBe(
      "This question references a protected or disallowed topic and can't be published. Rephrase it to stay job-related.",
    );
  });

  it("returns the exact current English criterion warning", () => {
    expect(getServerT("en")("compliance.criterionWarning")).toBe(
      "This criterion references a protected or disallowed topic and can't be published. Keep it job-related.",
    );
  });

  it("builds the EN classifier block message from a friendly label + reason", () => {
    expect(
      getServerT("en")("compliance.classifierDisallowedTopicBlock", {
        category: "Age",
        reason: "Asks for the candidate's age.",
      }),
    ).toBe(
      "Remove a protected or disallowed topic from your interview (Age): Asks for the candidate's age.",
    );
  });

  it("returns non-empty FR copy for every message", () => {
    const t = getServerT("fr");
    expect(t("compliance.planDisallowedTopicBlock").trim().length).toBeGreaterThan(
      0,
    );
    expect(t("compliance.questionWarning").trim().length).toBeGreaterThan(0);
    expect(t("compliance.criterionWarning").trim().length).toBeGreaterThan(0);
    expect(
      t("compliance.classifierDisallowedTopicBlock", {
        category: "Âge",
        reason: "raison",
      }).trim().length,
    ).toBeGreaterThan(0);
  });

  it("uses the agreed FR block translation", () => {
    expect(getServerT("fr")("compliance.planDisallowedTopicBlock")).toBe(
      "Retirez les sujets protégés ou interdits de vos questions et de vos critères d'évaluation.",
    );
  });

  it("interpolates label and reason into the FR classifier template", () => {
    const message = getServerT("fr")(
      "compliance.classifierDisallowedTopicBlock",
      { category: "Âge", reason: "Demande l'âge du candidat." },
    );
    expect(message).toContain("Âge");
    expect(message).toContain("Demande l'âge du candidat.");
  });

  it("differs between locales for the block message", () => {
    expect(getServerT("en")("compliance.planDisallowedTopicBlock")).not.toBe(
      getServerT("fr")("compliance.planDisallowedTopicBlock"),
    );
  });
});
