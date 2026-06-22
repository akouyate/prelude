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

  return disallowedQuestionTopics.some((topic) => {
    const normalizedTopic = topic.toLowerCase();
    const matchesPhrase = (phrase: string) =>
      new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "u").test(text);

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
