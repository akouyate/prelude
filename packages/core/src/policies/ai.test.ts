import { describe, expect, it } from "vitest";

import {
  aiGuardrails,
  buildAiCompliancePromptContext,
  candidateConsentCopy,
  candidateConsentCopyVersion,
  candidateDisclosureCopy,
  candidateDisclosureCopyVersion,
  complianceFlagCodes,
  defaultComplianceFlags,
  disallowedQuestionTopics,
  findForbiddenAutomatedDecisionPhrases,
  humanInLoopRule,
  recruiterLimitationCopy,
  recruiterLimitationCopyVersion,
  sensitiveInformationHandlingRule,
} from "./ai";

describe("AI compliance policy", () => {
  it("discloses the AI interviewer and human review boundaries", () => {
    expect(candidateConsentCopyVersion).toBe("candidate-consent-v1");
    expect(candidateDisclosureCopyVersion).toBe("candidate-disclosure-v1");
    expect(recruiterLimitationCopyVersion).toBe("recruiter-limitation-v1");
    expect(candidateDisclosureCopy).toContain("AI-guided interviewer");
    expect(candidateDisclosureCopy).toContain("reviewed by a recruiter");
    expect(candidateConsentCopy).toContain("recorded and transcribed");
    expect(recruiterLimitationCopy).toContain("human screening review only");
    expect(humanInLoopRule).toContain("human recruiter");
  });

  it("keeps protected and biometric topics out of automated review", () => {
    expect(disallowedQuestionTopics).toEqual(
      expect.arrayContaining([
        "age",
        "appearance",
        "biometric or face analysis",
      ]),
    );
    expect(aiGuardrails.join(" ")).toContain("protected attributes");
    expect(defaultComplianceFlags).toEqual(
      expect.arrayContaining([
        complianceFlagCodes.humanReviewRequired,
        complianceFlagCodes.protectedTraitsExcluded,
        complianceFlagCodes.biometricScoringDisallowed,
      ]),
    );
  });

  it("builds a reusable prompt context from the canonical policy", () => {
    const promptContext = buildAiCompliancePromptContext();

    expect(promptContext).toContain(humanInLoopRule);
    expect(promptContext).toContain(sensitiveInformationHandlingRule);
    expect(promptContext).toContain("biometric or face analysis");
    expect(promptContext).toContain("candidate-disclosure-v1");
  });

  it("detects risky automated-decision wording", () => {
    expect(
      findForbiddenAutomatedDecisionPhrases(
        "Move only qualified profiles forward after a candidate score.",
      ),
    ).toEqual(["qualified profiles", "candidate score"]);
    expect(
      findForbiddenAutomatedDecisionPhrases(
        "Prelude supports human screening review only.",
      ),
    ).toHaveLength(0);
  });
});
