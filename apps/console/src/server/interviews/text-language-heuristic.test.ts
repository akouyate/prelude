import { describe, expect, it } from "vitest";

import { dominantStopwordLanguage } from "./text-language-heuristic";

describe("dominantStopwordLanguage", () => {
  it("reads a French recruiter paragraph as French", () => {
    expect(
      dominantStopwordLanguage(
        "La présélection contient des éléments concrets et exploitables sur la gestion des clients, mais le recruteur doit clarifier les points manquants avant de poursuivre.",
      ),
    ).toBe("fr");
  });

  it("reads an English recruiter paragraph as English", () => {
    expect(
      dominantStopwordLanguage(
        "The screen contains concrete and reviewable evidence about customer work, but the recruiter should clarify the missing details before advancing.",
      ),
    ).toBe("en");
  });

  it("survives a verbatim English quote embedded in French analysis", () => {
    expect(
      dominantStopwordLanguage(
        "La présélection contient des éléments exploitables sur la relation client. Le candidat a déclaré : \"I coordinated support and product to reduce onboarding delays.\" Le recruteur doit confirmer les résultats chiffrés avant de décider de la suite.",
      ),
    ).toBe("fr");
  });

  it("returns null when neither language dominates", () => {
    expect(
      dominantStopwordLanguage("The recruiter doit clarifier the points."),
    ).toBeNull();
  });

  it("returns null when there is not enough text to judge", () => {
    expect(dominantStopwordLanguage("")).toBeNull();
    expect(dominantStopwordLanguage("Customer judgement")).toBeNull();
  });

  it("ignores accents and punctuation when counting stopwords", () => {
    expect(
      dominantStopwordLanguage(
        "Aucun tour de parole du candidat n'était disponible : l'entretien n'a pas couvert les questions prévues, et le recruteur doit relancer.",
      ),
    ).toBe("fr");
  });
});
