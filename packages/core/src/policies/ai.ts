export const complianceFlagCodes = {
  biometricScoringDisallowed: "biometric_scoring_disallowed",
  humanReviewRequired: "human_review_required",
  jobRelatedQuestionsOnly: "job_related_questions_only",
  protectedTraitsExcluded: "protected_traits_excluded",
  sensitiveSignalReviewRequired: "sensitive_signal_review_required",
} as const;

export type ComplianceFlagCode =
  (typeof complianceFlagCodes)[keyof typeof complianceFlagCodes];

// Shared category enum for the N6 second-layer protected-topic classifier.
// Index-aligned with the keyword policy's coarse topics; "none" means clean.
export const protectedTopicCategories = [
  "age",
  "appearance",
  "accent",
  "emotion",
  "ethnicity_or_origin",
  "disability_or_health",
  "family_or_pregnancy",
  "gender_or_sexual_orientation",
  "religion_or_political_opinion",
  "biometric_or_face_analysis",
  "criminal_record",
  "credit_or_financial",
  "genetic_information",
  "union_or_political_activity",
  "automated_decision",
  // Neutral fallback used by the deterministic provider and by the LLM-parse
  // path when a flagged verdict carries no usable specific category.
  "protected_topic",
  "none",
] as const;

export type ProtectedTopicCategory = (typeof protectedTopicCategories)[number];

export const aiCompliancePolicyVersion = "ai-compliance-v1";
// v2 introduces audio-recording disclosure + consent (voice capture, retention,
// erasure, EU residency). v1 is retained only as the historical label stamped on
// already-consented sessions — never reuse the v1 label for new copy.
export const candidateDisclosureCopyVersion = "candidate-disclosure-v2";
export const candidateConsentCopyVersion = "candidate-consent-v2";
export const recruiterLimitationCopyVersion = "recruiter-limitation-v1";

// Audio-consent versions accepted by the recording subsystem: only sessions
// consented under one of these may be audio-recorded (v1 disclosed transcript
// evidence only, not voice capture).
export const audioRecordingConsentCopyVersions = ["candidate-consent-v2"] as const;

export const candidateDisclosureCopy =
  "You are speaking with an AI-guided interviewer for a first screening. This interview is audio-recorded so a recruiter can review your answers later. Your answers are reviewed by a recruiter; Prelude does not assess protected attributes, appearance, accent, tone, or emotion.";

export const candidateConsentCopy =
  "I understand that I am joining an AI-guided first-screening interview. An audio recording of my voice, together with a transcript, will be created and stored in the EU as evidence for recruiter review, and may be processed by Prelude's recording provider for that purpose. The recording is kept for up to 90 days and then permanently deleted, and I can request deletion of my recording at any time. Prelude must not assess protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

export const recruiterLimitationCopy =
  "Prelude supports human screening review only. It must not be used as an automated hiring or rejection decision, and it excludes protected traits, appearance, accent, tone, emotion, personality, and biometric signals.";

export const humanInLoopRule =
  "A human recruiter remains responsible for every hiring, rejection, follow-up, or archive decision.";

export const sensitiveInformationHandlingRule =
  "If a candidate volunteers protected or sensitive information, exclude it from scoring, recommendations, and evidence rationale; flag that sensitive information was excluded for human review.";

export const disallowedQuestionTopics = [
  "age",
  "appearance",
  "accent",
  "emotion",
  "ethnicity or origin",
  "disability or health status",
  "family status or pregnancy",
  "gender identity or sexual orientation",
  "religion or political opinion",
  "biometric or face analysis",
] as const;

// Real-world proxy phrases recruiters actually type that the broad category
// labels above miss. Matched as literal word-boundary phrases (no " or " split),
// covering EU protected classes and US EEOC/ADA/ADEA/GINA. Deliberately avoids
// ambiguous bare tokens (citizen, authorized, native, family, record, credit) —
// only multi-word phrases — to limit over-blocking of legitimate job questions.
export const disallowedProxyPhrases = [
  // age (EU age + US ADEA 40+)
  "how old are you",
  "how old are",
  "what is your age",
  "your age",
  "date of birth",
  "year of birth",
  "birth year",
  "when were you born",
  "graduation year",
  "when did you graduate",
  "year you graduated",
  "digital native",
  "recent graduate",
  "years until retirement",
  "when do you plan to retire",
  "nearing retirement",
  "overqualified for",
  "how many years until you retire",
  // family / pregnancy / caregiving
  "how many children",
  "do you have children",
  "do you have kids",
  "any kids",
  "how many kids",
  "are you pregnant",
  "planning to have children",
  "plan to start a family",
  "family plans",
  "planning a family",
  "are you married",
  "marital status",
  "your spouse",
  "husband or wife",
  "maternity leave",
  "paternity leave",
  "who takes care of",
  "childcare arrangements",
  "do you have childcare",
  "arrange childcare",
  "dependents do you have",
  "trying to conceive",
  "expecting a child",
  "on birth control",
  // disability / health (US ADA)
  "medical condition",
  "health condition",
  "chronic illness",
  "mental health",
  "mental illness",
  "disability do you have",
  "are you disabled",
  "have a disability",
  "how many sick days",
  "sick days did you take",
  "currently taking any medication",
  "prescription medication",
  "seen a therapist",
  "psychiatric",
  "workers comp",
  "workers compensation claim",
  "how is your health",
  "any health problems",
  "have you been hospitalized",
  "do you smoke",
  // national origin / citizenship / race
  "where are you from originally",
  "where are you really from",
  "what is your nationality",
  "your nationality",
  "country of origin",
  "country of birth",
  "where were you born",
  "are you a us citizen",
  "what is your citizenship",
  "your citizenship status",
  "do you have a green card",
  "is english your first language",
  "native speaker",
  "native english speaker",
  "mother tongue",
  "your accent",
  "where is your accent from",
  "your ethnicity",
  "what race",
  "your race",
  "do you have an accent",
  "is english your native",
  "your native language",
  // religion
  "what religion",
  "your religion",
  "religious holidays",
  "which church",
  "do you go to church",
  "what is your faith",
  "do you observe",
  "religious observance",
  "do you pray",
  "your religious",
  "do you celebrate christmas",
  "wear a head covering",
  // gender identity / sexual orientation
  "your sexual orientation",
  "are you gay",
  "are you straight",
  "your gender identity",
  "are you transgender",
  "do you have a girlfriend",
  "do you have a boyfriend",
  "husband or a wife",
  "what are your pronouns",
  "were you born a",
  "your preferred gender",
  // genetic information (US GINA)
  "family medical history",
  "genetic condition",
  "genetic test",
  "run in your family",
  "inherited condition",
  "family history of",
  "hereditary",
  "predisposed to",
  // arrest / conviction history
  "have you ever been arrested",
  "ever been arrested",
  "arrest record",
  "criminal record",
  "ever been convicted",
  "any convictions",
  "your criminal history",
  "spent time in jail",
  "been to prison",
  "on probation",
  "on parole",
  // credit / financial history
  "your credit score",
  "your credit history",
  "filed for bankruptcy",
  "declared bankruptcy",
  "been in debt",
  "wages garnished",
  "your financial situation",
] as const;

// French-language proxy phrases (launch locale: FR). Matched with the same
// Unicode-aware word boundaries as the English list. Masculine/feminine forms
// are listed separately because matching is literal (no lemmatization). Avoids
// ambiguous bare tokens (français = nationality vs language; permis = driving
// vs work; enceinte = pregnant vs speaker) — only multi-word phrases.
// Residual risk: a few personal-health phrases ("problème de santé", "maladie
// chronique") can still collide with domain vocabulary for health-sector roles;
// resolving self-vs-domain ambiguity is deferred to the N6 LLM classifier.
export const disallowedProxyPhrasesFr = [
  // âge
  "quel âge avez-vous",
  "quel âge as-tu",
  "votre âge",
  "votre date de naissance",
  "date de naissance",
  "année de naissance",
  "en quelle année êtes-vous né",
  "en quelle année êtes-vous née",
  "quand êtes-vous né",
  "quand êtes-vous née",
  "année d'obtention du diplôme",
  "année d'obtention de votre diplôme",
  "en quelle année avez-vous obtenu",
  "jeune diplômé",
  "jeune diplômée",
  "proche de la retraite",
  "bientôt à la retraite",
  "départ à la retraite",
  "dans combien d'années comptez-vous partir à la retraite",
  "quand comptez-vous partir à la retraite",
  "surqualifié pour ce poste",
  "surqualifiée pour ce poste",
  // situation familiale / grossesse / garde d'enfants
  "avez-vous des enfants",
  "as-tu des enfants",
  "combien d'enfants avez-vous",
  "combien d'enfants",
  "vous avez des enfants",
  "êtes-vous enceinte",
  "es-tu enceinte",
  "comptez-vous avoir des enfants",
  "comptez-vous fonder une famille",
  "désirez-vous des enfants",
  "projet de grossesse",
  "congé maternité",
  "congé de maternité",
  "congé paternité",
  "congé parental",
  "êtes-vous marié",
  "êtes-vous mariée",
  "êtes-vous pacsé",
  "êtes-vous pacsée",
  "êtes-vous en couple",
  "situation de famille",
  "situation familiale",
  "votre situation matrimoniale",
  "votre conjoint",
  "votre conjointe",
  "votre mari",
  "votre épouse",
  "mode de garde",
  "garde de vos enfants",
  "qui garde vos enfants",
  "qui s'occupe de vos enfants",
  "personnes à charge avez-vous",
  // handicap / santé
  "problème de santé",
  "problèmes de santé",
  "votre état de santé",
  "comment va votre santé",
  "maladie chronique",
  "maladie de longue durée",
  "affection de longue durée",
  "travailleur handicapé",
  "travailleuse handicapée",
  "reconnaissance de la qualité de travailleur handicapé",
  "avez-vous une rqth",
  "êtes-vous en situation de handicap",
  "avez-vous un handicap",
  "êtes-vous handicapé",
  "êtes-vous handicapée",
  "taux d'incapacité",
  "arrêt maladie",
  "arrêts maladie",
  "combien d'arrêts maladie",
  "combien de jours d'arrêt",
  "suivez-vous un traitement médical",
  "traitement médical en cours",
  "prenez-vous des médicaments",
  "santé mentale",
  "suivi psychologique",
  "suivi psychiatrique",
  "avez-vous consulté un psychologue",
  "avez-vous été hospitalisé",
  "avez-vous été hospitalisée",
  "accident du travail",
  // origine / nationalité / prétendue race
  "d'où venez-vous vraiment",
  "d'où venez-vous à l'origine",
  "quelles sont vos origines",
  "quelle est votre origine",
  "votre pays d'origine",
  "pays d'origine",
  "quelle est votre nationalité",
  "votre nationalité",
  "êtes-vous français",
  "êtes-vous française",
  "êtes-vous de nationalité française",
  "où êtes-vous né",
  "où êtes-vous née",
  "votre pays de naissance",
  "quelle est votre origine ethnique",
  "votre origine ethnique",
  "votre langue maternelle",
  "quelle est votre langue maternelle",
  "avez-vous un accent",
  "d'où vient votre accent",
  "votre nom est d'origine",
  // religion / convictions
  "quelle est votre religion",
  "votre religion",
  "êtes-vous croyant",
  "êtes-vous croyante",
  "allez-vous à l'église",
  "allez-vous à la mosquée",
  "allez-vous à la synagogue",
  "fréquentez-vous une église",
  "fêtes religieuses",
  "pratiques religieuses",
  "portez-vous le voile",
  "faites-vous le ramadan",
  // opinions politiques / activité syndicale
  "vos opinions politiques",
  "quelles sont vos opinions politiques",
  "pour qui votez-vous",
  "êtes-vous syndiqué",
  "êtes-vous syndiquée",
  "appartenance syndicale",
  "activité syndicale",
  "êtes-vous engagé politiquement",
  "êtes-vous engagée politiquement",
  // orientation sexuelle / identité de genre
  "votre orientation sexuelle",
  "quelle est votre orientation sexuelle",
  "êtes-vous homosexuel",
  "êtes-vous homosexuelle",
  "avez-vous un petit ami",
  "avez-vous une petite amie",
  "êtes-vous marié à un homme",
  "êtes-vous mariée à une femme",
  "votre identité de genre",
  "êtes-vous transgenre",
  // casier judiciaire / antécédents
  "casier judiciaire",
  "votre casier judiciaire",
  "avez-vous un casier",
  "avez-vous déjà été condamné",
  "avez-vous déjà été condamnée",
  "antécédents judiciaires",
  "avez-vous fait de la prison",
  "avez-vous été incarcéré",
  "avez-vous été incarcérée",
  // situation financière
  "êtes-vous surendetté",
  "êtes-vous surendettée",
  "interdit bancaire",
] as const;

export const aiGuardrails = [
  "Analyze only candidate response content.",
  "Do not analyze face, accent, tone, emotion, or protected attributes.",
  "Do not make automatic hiring or rejection decisions.",
  "Keep final review and next-step decisions under human control.",
  "Ignore volunteered protected or sensitive information when forming recruiter-facing evidence.",
] as const;

export const defaultComplianceFlags = [
  complianceFlagCodes.humanReviewRequired,
  complianceFlagCodes.jobRelatedQuestionsOnly,
  complianceFlagCodes.protectedTraitsExcluded,
  complianceFlagCodes.biometricScoringDisallowed,
] as const satisfies readonly ComplianceFlagCode[];

export const forbiddenAutomatedDecisionPhrases = [
  "qualified profiles",
  "fit score",
  "candidate score",
  "rank candidates",
  "ranked candidates",
  "automatic rejection",
  "automated rejection",
  "ai decision",
] as const;

export function findForbiddenAutomatedDecisionPhrases(value: string) {
  const normalized = value.toLowerCase();

  return forbiddenAutomatedDecisionPhrases.filter((phrase) =>
    normalized.includes(phrase),
  );
}

export function textViolatesPolicy(value: string) {
  const text = value.toLowerCase();

  if (findForbiddenAutomatedDecisionPhrases(text).length > 0) {
    return true;
  }

  // Unicode-aware word boundaries: JS \b is ASCII-only, so it silently fails to
  // match phrases that start/end with accented letters (e.g. "êtes-vous
  // enceinte", "congé maternité"). Lookarounds on \p{L}\p{N} fix accented
  // boundaries and also avoid over-matching inflected forms (marié ⊄ mariée).
  const matchesPhrase = (phrase: string) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`,
      "u",
    ).test(text);

  if (
    disallowedProxyPhrases.some((phrase) => matchesPhrase(phrase)) ||
    disallowedProxyPhrasesFr.some((phrase) => matchesPhrase(phrase))
  ) {
    return true;
  }

  return disallowedQuestionTopics.some((topic) => {
    const normalizedTopic = topic.toLowerCase();

    return (
      matchesPhrase(normalizedTopic) ||
      normalizedTopic
        .split(" or ")
        .some((part) => part.length > 4 && matchesPhrase(part))
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildAiCompliancePromptContext() {
  return [
    `Policy version: ${aiCompliancePolicyVersion}.`,
    `Candidate disclosure version: ${candidateDisclosureCopyVersion}.`,
    `Recruiter limitation version: ${recruiterLimitationCopyVersion}.`,
    `Human review boundary: ${humanInLoopRule}`,
    `Recruiter limitation: ${recruiterLimitationCopy}`,
    `Disallowed question and review topics: ${disallowedQuestionTopics.join(", ")}.`,
    `Guardrails: ${aiGuardrails.join(" ")}`,
    `Sensitive information handling: ${sensitiveInformationHandlingRule}`,
  ].join("\n");
}
