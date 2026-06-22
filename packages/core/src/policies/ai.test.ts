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
  textViolatesPolicy,
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

describe("textViolatesPolicy", () => {
  it("flags text that references a protected topic", () => {
    expect(textViolatesPolicy("What is your age?")).toBe(true);
  });

  it("flags text with a forbidden automated-decision phrase", () => {
    expect(
      textViolatesPolicy("We compute a fit score for each candidate."),
    ).toBe(true);
  });

  it("allows a job-related, behavior-anchored question", () => {
    expect(
      textViolatesPolicy("Describe a project you led under a tight deadline."),
    ).toBe(false);
  });
});

describe("protected-topic proxy coverage (EU + US)", () => {
  const cases: Array<[string, boolean]> = [
    // Real-world protected-class proxies that the bare category labels miss.
    ["How old are you and when did you graduate?", true],
    ["What's your date of birth for our records?", true],
    ["Are you a digital native?", true],
    ["When did you graduate from university?", true],
    ["Do you have children or plan to start a family?", true],
    ["Are you pregnant or planning maternity leave soon?", true],
    ["Do you have childcare arranged for early shifts?", true],
    ["How many sick days did you take last year?", true],
    ["Do you have any medical condition we should know about?", true],
    ["Where are you really from? Are you a US citizen?", true],
    ["Is English your first language, or are you a native speaker?", true],
    ["Does heart disease run in your family?", true],
    ["Have you ever been arrested or convicted of a crime?", true],
    ["What is your credit score?", true],
    // Legitimate, job-related look-alikes that must NOT be flagged.
    ["Are you legally authorized to work in this country?", false],
    [
      "Can you perform the essential functions of the job with or without reasonable accommodation?",
      false,
    ],
    ["Do you meet the minimum years of experience for this role?", false],
    ["Can you work the required schedule, including occasional weekends?", false],
    ["Describe your experience building cloud-native applications.", false],
    ["Tell me about supporting a family of products at scale.", false],
    ["Walk me through your credit risk modeling track record.", false],
    ["Will you now or in the future require visa sponsorship?", false],
  ];

  it.each(cases)("textViolatesPolicy(%j) === %s", (text, shouldFlag) => {
    expect(textViolatesPolicy(text)).toBe(shouldFlag);
  });
});
