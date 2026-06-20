export const complianceFlagCodes = {
  biometricScoringDisallowed: "biometric_scoring_disallowed",
  humanReviewRequired: "human_review_required",
  jobRelatedQuestionsOnly: "job_related_questions_only",
  protectedTraitsExcluded: "protected_traits_excluded",
  sensitiveSignalReviewRequired: "sensitive_signal_review_required",
} as const;

export type ComplianceFlagCode =
  (typeof complianceFlagCodes)[keyof typeof complianceFlagCodes];

export const candidateDisclosureCopy =
  "You are speaking with an AI-guided interviewer for a first screening. Your answers are reviewed by a recruiter; Prelude does not assess protected attributes, appearance, accent, tone, or emotion.";

export const recruiterLimitationCopy =
  "Prelude supports human screening review only. It must not be used as an automated hiring or rejection decision, and it excludes protected traits, appearance, accent, tone, emotion, personality, and biometric signals.";

export const humanInLoopRule =
  "A human recruiter remains responsible for every hiring, rejection, follow-up, or archive decision.";

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
] as const;

export const defaultComplianceFlags = [
  complianceFlagCodes.humanReviewRequired,
  complianceFlagCodes.jobRelatedQuestionsOnly,
  complianceFlagCodes.protectedTraitsExcluded,
  complianceFlagCodes.biometricScoringDisallowed,
] as const satisfies readonly ComplianceFlagCode[];
