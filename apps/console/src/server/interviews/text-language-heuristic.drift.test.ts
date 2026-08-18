import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { dominantStopwordLanguage } from "./text-language-heuristic";
import {
  dominantStopwordLanguage as smokeDominantStopwordLanguage,
  SMOKE_DOMINANCE_RATIO,
  SMOKE_ENGLISH_STOPWORDS,
  SMOKE_FRENCH_STOPWORDS,
  SMOKE_MINIMUM_HITS,
} from "../../../../../scripts/e2e-smoke.mjs";

/**
 * `scripts/e2e-smoke.mjs` carries a hand-synced COPY of this module's stopword
 * heuristic. The copy exists because the seeder runs as plain Node against a
 * live database with no TypeScript build step in front of it, so it cannot
 * import the console's source; duplicating ~60 stopwords is cheaper than
 * compiling an app to seed a table.
 *
 * A hand-synced copy with no guard is a silent-rot hazard: adding a stopword
 * here would leave the smoke's language assertions grading against the old
 * list, and the smoke would keep reporting Pass while measuring something else.
 * This file is that guard.
 *
 * Two independent nets, because each covers the other's blind spot:
 * 1. VALUE equality of the tables and thresholds — exact, catches any edit.
 * 2. BEHAVIOURAL equality on boundary inputs — format-independent, still bites
 *    if the source-shape extraction below ever stops matching.
 */

const heuristicSource = readFileSync(
  fileURLToPath(new URL("./text-language-heuristic.ts", import.meta.url)),
  "utf8",
);

/**
 * The console-side constants are module-private and this test must not widen
 * that surface just to be observable, so they are read out of the source text.
 *
 * Every extractor below asserts it actually found something: a rename or a
 * reformat that defeats the match fails the test loudly instead of quietly
 * comparing two empty sets and calling it a match.
 */
function extractStopwordSet(constantName: string): Set<string> {
  const block = new RegExp(
    `const ${constantName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`,
  ).exec(heuristicSource);
  expect(
    block,
    `could not find ${constantName} in text-language-heuristic.ts — the drift guard needs updating`,
  ).not.toBeNull();

  const words = [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
  expect(words.length).toBeGreaterThan(0);

  return new Set(words);
}

function extractThreshold(constantName: string): number {
  const match = new RegExp(`const ${constantName} = (\\d+);`).exec(
    heuristicSource,
  );
  expect(
    match,
    `could not find ${constantName} in text-language-heuristic.ts — the drift guard needs updating`,
  ).not.toBeNull();

  return Number(match?.[1]);
}

const sorted = (values: Set<string>) => [...values].sort();

describe("smoke seeder language heuristic stays in sync with the console", () => {
  it("copies the English stopword table exactly", () => {
    expect(sorted(SMOKE_ENGLISH_STOPWORDS)).toEqual(
      sorted(extractStopwordSet("ENGLISH_STOPWORDS")),
    );
  });

  it("copies the French stopword table exactly", () => {
    expect(sorted(SMOKE_FRENCH_STOPWORDS)).toEqual(
      sorted(extractStopwordSet("FRENCH_STOPWORDS")),
    );
  });

  it("copies both thresholds exactly", () => {
    expect(SMOKE_MINIMUM_HITS).toBe(extractThreshold("MINIMUM_HITS"));
    expect(SMOKE_DOMINANCE_RATIO).toBe(extractThreshold("DOMINANCE_RATIO"));
  });

  // The lists stay disjoint on both sides: a word counted for both languages
  // would make the dominance ratio meaningless.
  it("keeps the two tables disjoint", () => {
    const overlap = [...SMOKE_ENGLISH_STOPWORDS].filter((word) =>
      SMOKE_FRENCH_STOPWORDS.has(word),
    );
    expect(overlap).toEqual([]);
  });

  // Boundary-heavy corpus: just under and just over MINIMUM_HITS, a mixed
  // paragraph that must stay ambiguous, accents, and empty input.
  it("returns the same verdict as the console for every boundary input", () => {
    const corpus = [
      "",
      "   ",
      "the and",
      "the and is",
      "the and is of that",
      "les des une",
      "les des une pour",
      "Les criteres sont evalues pour ce poste avec des exemples concrets.",
      "The candidate described onboarding work and the impact of that project.",
      "the and is les des une",
      "La candidate a dit: 'I led onboarding for enterprise customers and the team'.",
      "Qu'est-ce qui vous a donné envie de rejoindre ce poste ?",
      "What made you want to join this position, and what is the draw for you?",
      "12345 !!! ---",
    ];

    for (const text of corpus) {
      expect(
        smokeDominantStopwordLanguage(text),
        `divergent verdict for: ${JSON.stringify(text)}`,
      ).toBe(dominantStopwordLanguage(text));
    }
  });
});
