import type { ProtectedTopicCategory } from "../policies/ai";

// N6c: narrow, opt-in localization of the RECRUITER-FACING compliance copy
// (publish/save block, the N6 classifier block, and the two builder inline
// warnings) plus friendly labels for the protected-topic category enum.
//
// Scope is deliberately small: this is NOT a general i18n framework. The default
// locale is "en" and its strings are byte-identical to the previous hardcoded
// English so existing tests and behavior are unchanged. French is opt-in via an
// environment variable.

export const consoleLocales = ["en", "fr"] as const;

export type ConsoleLocale = (typeof consoleLocales)[number];

type ConsoleLocaleSource = Record<string, string | undefined>;

// Read process.env without referencing the `process` global directly: @prelude/core
// is environment-agnostic and does not depend on @types/node, so we reach the env
// bag through globalThis and tolerate its absence (e.g. minimal client bundles).
function defaultLocaleSource(): ConsoleLocaleSource {
  const proc = (globalThis as { process?: { env?: ConsoleLocaleSource } })
    .process;

  return proc?.env ?? {};
}

function coerceLocale(value: string | undefined): ConsoleLocale | undefined {
  return value === "en" || value === "fr" ? value : undefined;
}

/**
 * Resolve the console locale from the environment. Reads `CONSOLE_LOCALE` first,
 * then `NEXT_PUBLIC_CONSOLE_LOCALE` (so client components that only see
 * `NEXT_PUBLIC_*` vars still work). Anything other than "en" or "fr" — including
 * an empty string or unset — resolves to "en". Pure: pass a custom source for
 * testing.
 */
export function resolveConsoleLocale(
  source: ConsoleLocaleSource = defaultLocaleSource(),
): ConsoleLocale {
  return (
    coerceLocale(source.CONSOLE_LOCALE) ??
    coerceLocale(source.NEXT_PUBLIC_CONSOLE_LOCALE) ??
    "en"
  );
}

// Friendly, recruiter-facing labels for every protected-topic category, in both
// supported locales. Exhaustive over the enum (asserted by a test). FR copy is
// legal-adjacent and intended for HR review.
const protectedTopicCategoryLabels: Record<
  ProtectedTopicCategory,
  Record<ConsoleLocale, string>
> = {
  age: { en: "Age", fr: "Âge" },
  appearance: { en: "Appearance", fr: "Apparence physique" },
  accent: { en: "Accent", fr: "Accent" },
  emotion: { en: "Emotion", fr: "Émotion" },
  ethnicity_or_origin: {
    en: "Ethnicity or origin",
    fr: "Origine ethnique ou nationale",
  },
  disability_or_health: {
    en: "Disability or health",
    fr: "Handicap ou état de santé",
  },
  family_or_pregnancy: {
    en: "Family or pregnancy",
    fr: "Situation familiale ou grossesse",
  },
  gender_or_sexual_orientation: {
    en: "Gender or sexual orientation",
    fr: "Genre ou orientation sexuelle",
  },
  religion_or_political_opinion: {
    en: "Religion or political opinion",
    fr: "Religion ou opinion politique",
  },
  biometric_or_face_analysis: {
    en: "Biometric or face analysis",
    fr: "Analyse biométrique ou faciale",
  },
  criminal_record: {
    en: "Criminal record",
    fr: "Casier judiciaire",
  },
  credit_or_financial: {
    en: "Credit or financial",
    fr: "Situation financière ou crédit",
  },
  genetic_information: {
    en: "Genetic information",
    fr: "Informations génétiques",
  },
  union_or_political_activity: {
    en: "Union or political activity",
    fr: "Activité syndicale ou engagement politique",
  },
  automated_decision: {
    en: "Automated decision",
    fr: "Décision automatisée",
  },
  protected_topic: { en: "Protected topic", fr: "Sujet protégé" },
  none: { en: "Protected topic", fr: "Sujet protégé" },
};

/**
 * Friendly, localized label for a protected-topic category. Used to replace the
 * raw snake_case enum token in recruiter-facing copy (e.g. the N6 classifier
 * block message). Falls back to the neutral "protected topic" label if an
 * unrecognized category is ever passed.
 */
export function protectedTopicCategoryLabel(
  category: ProtectedTopicCategory,
  locale: ConsoleLocale,
): string {
  const entry =
    protectedTopicCategoryLabels[category] ??
    protectedTopicCategoryLabels.protected_topic;

  return entry[locale];
}

export type ComplianceMessages = {
  /** Publish gate + save reject when the plan references a disallowed topic. */
  planDisallowedTopicBlock: string;
  /** N6 classifier hard block. Takes a friendly category label + the reason. */
  classifierDisallowedTopicBlock: (
    categoryLabel: string,
    reason: string,
  ) => string;
  /** Builder inline warning under a flagged question. */
  questionDisallowedTopicWarning: string;
  /** Builder inline warning under a flagged criterion. */
  criterionDisallowedTopicWarning: string;
};

const messagesByLocale: Record<ConsoleLocale, ComplianceMessages> = {
  en: {
    planDisallowedTopicBlock:
      "Remove protected or disallowed topics from your questions and evaluation criteria.",
    classifierDisallowedTopicBlock: (categoryLabel, reason) =>
      `Remove a protected or disallowed topic from your interview (${categoryLabel}): ${reason}`,
    questionDisallowedTopicWarning:
      "This question references a protected or disallowed topic and can't be published. Rephrase it to stay job-related.",
    criterionDisallowedTopicWarning:
      "This criterion references a protected or disallowed topic and can't be published. Keep it job-related.",
  },
  fr: {
    planDisallowedTopicBlock:
      "Retirez les sujets protégés ou interdits de vos questions et de vos critères d'évaluation.",
    classifierDisallowedTopicBlock: (categoryLabel, reason) =>
      `Retirez un sujet protégé ou interdit de votre entretien (${categoryLabel}) : ${reason}`,
    questionDisallowedTopicWarning:
      "Cette question fait référence à un sujet protégé ou interdit et ne peut pas être publiée. Reformulez-la pour qu'elle reste liée au poste.",
    criterionDisallowedTopicWarning:
      "Ce critère fait référence à un sujet protégé ou interdit et ne peut pas être publié. Reformulez-le pour qu'il reste lié au poste.",
  },
};

/** Localized recruiter-facing compliance copy for the given locale. */
export function complianceMessages(locale: ConsoleLocale): ComplianceMessages {
  return messagesByLocale[locale];
}
