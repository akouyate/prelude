export const complianceFlagCodes = {
  biometricScoringDisallowed: "biometric_scoring_disallowed",
  humanReviewRequired: "human_review_required",
  jobRelatedQuestionsOnly: "job_related_questions_only",
  protectedTraitsExcluded: "protected_traits_excluded",
  sensitiveSignalReviewRequired: "sensitive_signal_review_required",
} as const;

export type ComplianceFlagCode =
  (typeof complianceFlagCodes)[keyof typeof complianceFlagCodes];

export const aiCompliancePolicyVersion = "ai-compliance-v1";
export const candidateDisclosureCopyVersion = "candidate-disclosure-v1";
export const candidateConsentCopyVersion = "candidate-consent-v1";
export const recruiterLimitationCopyVersion = "recruiter-limitation-v1";

export const candidateDisclosureCopy =
  "You are speaking with an AI-guided interviewer for a first screening. Your answers are reviewed by a recruiter; Prelude does not assess protected attributes, appearance, accent, tone, or emotion.";

export const candidateConsentCopy =
  "I understand that I am joining an AI-guided first-screening interview. My answers may be recorded and transcribed as evidence for recruiter review, and Prelude must not assess protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

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

  const matchesPhrase = (phrase: string) =>
    new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "u").test(text);

  if (disallowedProxyPhrases.some((phrase) => matchesPhrase(phrase))) {
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
