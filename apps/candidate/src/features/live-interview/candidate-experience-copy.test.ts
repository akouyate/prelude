import { describe, expect, it } from "vitest";

import { candidateExperienceCopy } from "./candidate-experience-copy";

describe("candidate experience copy", () => {
  it("keeps the French and English tables on identical key sets", () => {
    // The table is the only place either language exists, so a key present on
    // one side and missing on the other would ship an English string inside a
    // French consent surface — the failure this parity check exists to catch.
    expect(Object.keys(candidateExperienceCopy("fr")).sort()).toEqual(
      Object.keys(candidateExperienceCopy("en")).sort(),
    );
  });

  it("leaves no entry empty in either language", () => {
    // Templates take either a company name or an input object depending on the
    // entry, so the probe hands both shapes to whichever one it is calling.
    const probe = Object.assign("Acme", {
      companyName: "Acme",
      jobTitle: "Backend Engineer",
      minutes: 8,
      roleTitle: "Backend Engineer",
    });

    (["en", "fr"] as const).forEach((language) => {
      const table = candidateExperienceCopy(language) as unknown as Record<
        string,
        string | ((input: unknown) => string)
      >;

      Object.entries(table).forEach(([key, value]) => {
        const rendered = typeof value === "function" ? value(probe) : value;

        expect(`${language}.${key}: ${rendered.trim().length > 0}`).toBe(
          `${language}.${key}: true`,
        );
      });
    });
  });

  it("localizes the withdrawal surface, which is part of the consent surface", () => {
    // GDPR art. 7(3): withdrawing has to be as easy as consenting, which means
    // readable in the same language as the consent.
    const fr = candidateExperienceCopy("fr");

    expect(fr.quit).toBe("Quitter");
    expect(fr.abandonedTitle).toBe("Entretien interrompu");
    expect(fr.abandonedBody("Acme")).toContain("Acme");
    expect(fr.abandonedRetry).toBe("Démarrer une nouvelle tentative");
  });

  it("localizes the disclosure closing note carried inside the paragraph", () => {
    const fr = candidateExperienceCopy("fr");

    expect(`${fr.listeningNoteLead} ${fr.listeningNoteEmphasis}.`).toBe(
      "Nous écoutons ce que vous dites.",
    );
  });

  it("localizes the recruiter preview disclosure and consent", () => {
    const fr = candidateExperienceCopy("fr");

    expect(fr.previewDisclosureCopy).toContain("aperçu recruteur");
    expect(fr.previewConsentCopy).toContain("test en direct");
  });

  it("formats durations in the reader's language", () => {
    expect(candidateExperienceCopy("en").durationLong(8)).toBe(
      "About 8 minutes",
    );
    expect(candidateExperienceCopy("fr").durationLong(8)).toBe(
      "Environ 8 minutes",
    );
    expect(
      candidateExperienceCopy("fr").preflightSubtitle({
        jobTitle: "Ingénieur backend",
        minutes: null,
      }),
    ).toBe("Ingénieur backend");
  });
});
