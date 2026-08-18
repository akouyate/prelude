import type { WorkspaceLanguage } from "@prelude/contracts";

/**
 * Which catalogue language a piece of generated prose reads as, decided by
 * counting function words. Deliberately a heuristic, not a detector: it exists
 * so the gated live tests can assert that a French workspace really got French
 * analysis without pulling a langdetect-style dependency into the app.
 *
 * Returns `null` rather than guessing whenever the signal is thin or split —
 * a caller asserting `"fr"` should fail on ambiguity, not coin-flip.
 */
export function dominantStopwordLanguage(
  text: string,
): WorkspaceLanguage | null {
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

  let english = 0;
  let french = 0;

  for (const token of tokens) {
    if (ENGLISH_STOPWORDS.has(token)) {
      english += 1;
    }
    if (FRENCH_STOPWORDS.has(token)) {
      french += 1;
    }
  }

  if (english >= MINIMUM_HITS && english >= french * DOMINANCE_RATIO) {
    return "en";
  }

  if (french >= MINIMUM_HITS && french >= english * DOMINANCE_RATIO) {
    return "fr";
  }

  return null;
}

// A recruiter brief always carries an interview's worth of prose, so three
// function words is a floor for "there is something to judge", not a target.
const MINIMUM_HITS = 3;
// Generated French analysis quoting an English answer verbatim still clears
// this; a genuinely mixed-language paragraph does not.
const DOMINANCE_RATIO = 2;

// Both lists are accent-folded (the tokens are) and deliberately disjoint:
// words that exist in both languages ("a", "on", "or", "as", "son", "plus",
// "but") are excluded rather than counted for the wrong side.
const ENGLISH_STOPWORDS = new Set([
  "and",
  "are",
  "been",
  "before",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "its",
  "not",
  "of",
  "should",
  "than",
  "that",
  "the",
  "their",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "when",
  "which",
  "while",
  "with",
]);

const FRENCH_STOPWORDS = new Set([
  "au",
  "aucun",
  "aux",
  "avant",
  "avec",
  "ces",
  "cet",
  "cette",
  "dans",
  "des",
  "doit",
  "du",
  "elle",
  "est",
  "etre",
  "la",
  "le",
  "les",
  "leur",
  "leurs",
  "mais",
  "notre",
  "nous",
  "pas",
  "peut",
  "pour",
  "qui",
  "sans",
  "ses",
  "sont",
  "sur",
  "tres",
  "une",
  "votre",
  "vous",
]);
