import { describe, expect, it } from "vitest";

import {
  aiGuardrails,
  candidateDisclosureCopy,
  complianceFlagCodes,
  defaultComplianceFlags,
  disallowedQuestionTopics,
  humanInLoopRule,
  recruiterLimitationCopy,
} from "./ai";

describe("AI compliance policy", () => {
  it("discloses the AI interviewer and human review boundaries", () => {
    expect(candidateDisclosureCopy).toContain("AI-guided interviewer");
    expect(candidateDisclosureCopy).toContain("reviewed by a recruiter");
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
});
