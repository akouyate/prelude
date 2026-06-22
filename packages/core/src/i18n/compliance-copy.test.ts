import { describe, expect, it } from "vitest";

import { protectedTopicCategories } from "../policies/ai";

import {
  complianceMessages,
  consoleLocales,
  protectedTopicCategoryLabel,
  resolveConsoleLocale,
  type ConsoleLocale,
} from "./compliance-copy";

describe("resolveConsoleLocale", () => {
  it("defaults to 'en' when no env var is set", () => {
    expect(resolveConsoleLocale({})).toBe("en");
  });

  it("reads CONSOLE_LOCALE when it is 'fr'", () => {
    expect(resolveConsoleLocale({ CONSOLE_LOCALE: "fr" })).toBe("fr");
  });

  it("reads CONSOLE_LOCALE when it is 'en'", () => {
    expect(resolveConsoleLocale({ CONSOLE_LOCALE: "en" })).toBe("en");
  });

  it("falls back to NEXT_PUBLIC_CONSOLE_LOCALE when CONSOLE_LOCALE is unset", () => {
    expect(
      resolveConsoleLocale({ NEXT_PUBLIC_CONSOLE_LOCALE: "fr" }),
    ).toBe("fr");
  });

  it("prefers CONSOLE_LOCALE over NEXT_PUBLIC_CONSOLE_LOCALE", () => {
    expect(
      resolveConsoleLocale({
        CONSOLE_LOCALE: "fr",
        NEXT_PUBLIC_CONSOLE_LOCALE: "en",
      }),
    ).toBe("fr");
  });

  it("coerces an unknown CONSOLE_LOCALE to 'en'", () => {
    expect(resolveConsoleLocale({ CONSOLE_LOCALE: "de" })).toBe("en");
    expect(resolveConsoleLocale({ CONSOLE_LOCALE: "" })).toBe("en");
    expect(resolveConsoleLocale({ CONSOLE_LOCALE: "FR" })).toBe("en");
  });

  it("coerces an unknown NEXT_PUBLIC_CONSOLE_LOCALE to 'en'", () => {
    expect(
      resolveConsoleLocale({ NEXT_PUBLIC_CONSOLE_LOCALE: "es" }),
    ).toBe("en");
  });

  it("defaults to 'en' when called with no argument (reads process.env)", () => {
    // The default source is process.env; in the test runner neither var is set.
    expect(resolveConsoleLocale()).toBe("en");
  });

  it("exposes the supported locale list", () => {
    expect(consoleLocales).toEqual(["en", "fr"]);
  });
});

describe("protectedTopicCategoryLabel", () => {
  const locales: ConsoleLocale[] = ["en", "fr"];

  it("returns a non-empty label for every category in every locale", () => {
    for (const category of protectedTopicCategories) {
      for (const locale of locales) {
        const label = protectedTopicCategoryLabel(category, locale);
        expect(typeof label).toBe("string");
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never leaks a raw snake_case enum token as a label", () => {
    for (const category of protectedTopicCategories) {
      for (const locale of locales) {
        const label = protectedTopicCategoryLabel(category, locale);
        expect(label).not.toContain("_");
      }
    }
  });

  it("uses friendly EN labels for representative categories", () => {
    expect(protectedTopicCategoryLabel("union_or_political_activity", "en")).toBe(
      "Union or political activity",
    );
    expect(protectedTopicCategoryLabel("automated_decision", "en")).toBe(
      "Automated decision",
    );
    expect(protectedTopicCategoryLabel("protected_topic", "en")).toBe(
      "Protected topic",
    );
    expect(protectedTopicCategoryLabel("age", "en")).toBe("Age");
  });

  it("uses friendly FR labels for representative categories", () => {
    expect(protectedTopicCategoryLabel("union_or_political_activity", "fr")).toBe(
      "Activité syndicale ou engagement politique",
    );
    expect(protectedTopicCategoryLabel("automated_decision", "fr")).toBe(
      "Décision automatisée",
    );
    expect(protectedTopicCategoryLabel("protected_topic", "fr")).toBe(
      "Sujet protégé",
    );
    expect(protectedTopicCategoryLabel("age", "fr")).toBe("Âge");
  });

  it("falls back to the neutral 'protected topic' label for an unknown category", () => {
    expect(
      protectedTopicCategoryLabel(
        "totally_unknown" as never,
        "en",
      ),
    ).toBe("Protected topic");
    expect(
      protectedTopicCategoryLabel(
        "totally_unknown" as never,
        "fr",
      ),
    ).toBe("Sujet protégé");
  });
});

describe("complianceMessages", () => {
  it("returns the exact current English block message", () => {
    expect(complianceMessages("en").planDisallowedTopicBlock).toBe(
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    );
  });

  it("returns the exact current English question warning", () => {
    expect(complianceMessages("en").questionDisallowedTopicWarning).toBe(
      "This question references a protected or disallowed topic and can't be published. Rephrase it to stay job-related.",
    );
  });

  it("returns the exact current English criterion warning", () => {
    expect(complianceMessages("en").criterionDisallowedTopicWarning).toBe(
      "This criterion references a protected or disallowed topic and can't be published. Keep it job-related.",
    );
  });

  it("builds the EN classifier block message from a friendly label + reason", () => {
    expect(
      complianceMessages("en").classifierDisallowedTopicBlock(
        "Age",
        "Asks for the candidate's age.",
      ),
    ).toBe(
      "Remove a protected or disallowed topic from your interview (Age): Asks for the candidate's age.",
    );
  });

  it("returns non-empty FR copy for every message", () => {
    const fr = complianceMessages("fr");
    expect(fr.planDisallowedTopicBlock.trim().length).toBeGreaterThan(0);
    expect(fr.questionDisallowedTopicWarning.trim().length).toBeGreaterThan(0);
    expect(fr.criterionDisallowedTopicWarning.trim().length).toBeGreaterThan(0);
    expect(
      fr.classifierDisallowedTopicBlock("Âge", "raison").trim().length,
    ).toBeGreaterThan(0);
  });

  it("uses the agreed FR block translation", () => {
    expect(complianceMessages("fr").planDisallowedTopicBlock).toBe(
      "Retirez les sujets protégés ou interdits de vos questions et de vos critères d'évaluation.",
    );
  });

  it("interpolates label and reason into the FR classifier template", () => {
    const message = complianceMessages("fr").classifierDisallowedTopicBlock(
      "Âge",
      "Demande l'âge du candidat.",
    );
    expect(message).toContain("Âge");
    expect(message).toContain("Demande l'âge du candidat.");
  });

  it("differs between locales for the block message", () => {
    expect(complianceMessages("en").planDisallowedTopicBlock).not.toBe(
      complianceMessages("fr").planDisallowedTopicBlock,
    );
  });
});
