import { describe, expect, it } from "vitest";

import {
  aiGuardrails,
  audioRecordingConsentCopyVersions,
  buildAiCompliancePromptContext,
  candidateConsentCopy,
  candidateConsentCopyVersion,
  candidateDisclosureCopy,
  candidateDisclosureCopyVersion,
  complianceFlagCodes,
  defaultComplianceFlags,
  disallowedProxyPhrases,
  disallowedProxyPhrasesFr,
  disallowedQuestionTopics,
  findForbiddenAutomatedDecisionPhrases,
  humanInLoopRule,
  recruiterLimitationCopy,
  recruiterLimitationCopyVersion,
  sensitiveInformationHandlingRule,
  protectedTopicCategories,
  textViolatesPolicy,
} from "./ai";

describe("protected topic categories", () => {
  it("exposes the shared classifier category enum", () => {
    expect(protectedTopicCategories).toEqual([
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
      "protected_topic",
      "none",
    ]);
  });

  it("includes a 'none' sentinel for clean text", () => {
    expect(protectedTopicCategories).toContain("none");
  });

  it("includes a neutral 'protected_topic' fallback category", () => {
    expect(protectedTopicCategories).toContain("protected_topic");
  });
});

describe("AI compliance policy", () => {
  it("discloses the AI interviewer and human review boundaries", () => {
    expect(candidateConsentCopyVersion).toBe("candidate-consent-v2");
    expect(candidateDisclosureCopyVersion).toBe("candidate-disclosure-v2");
    expect(recruiterLimitationCopyVersion).toBe("recruiter-limitation-v1");
    expect(candidateDisclosureCopy).toContain("AI-guided interviewer");
    expect(candidateDisclosureCopy).toContain("reviewed by a recruiter");
    expect(candidateDisclosureCopy).toContain("audio-recorded");
    expect(candidateConsentCopy).toContain("audio recording of my voice");
    expect(candidateConsentCopy).toContain("request deletion of my recording");
    expect(recruiterLimitationCopy).toContain("human screening review only");
    expect(humanInLoopRule).toContain("human recruiter");
  });

  it("keeps the audio-recording consent allowlist in lockstep with the consent version", () => {
    // Only sessions consented under an audio-disclosing version may be recorded.
    // The current consent version MUST be in the allowlist, or the Go recording
    // gate — which mirrors this list — would refuse to record freshly consented
    // candidates. Bumping the version without extending the allowlist fails here.
    expect(audioRecordingConsentCopyVersions).toContain(candidateConsentCopyVersion);
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
    expect(promptContext).toContain("candidate-disclosure-v2");
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
    // Unicode-boundary equivalence: a proxy must not match mid-word (race ⊄ racecar).
    ["Tell me about your racecar telemetry project.", false],
  ];

  it.each(cases)("textViolatesPolicy(%j) === %s", (text, shouldFlag) => {
    expect(textViolatesPolicy(text)).toBe(shouldFlag);
  });
});

// N10.B — every proxy phrase must be a live word-boundary entry. A phrase that
// cannot even match itself (when padded with spaces) is dead weight that gives a
// false sense of coverage; this catches a typo'd or stray-character entry.
describe("N10 proxy phrases are all live word-boundary entries", () => {
  it.each(disallowedProxyPhrases)(
    "EN proxy %j matches itself when padded",
    (phrase) => {
      expect(textViolatesPolicy(` ${phrase} `)).toBe(true);
    },
  );

  it.each(disallowedProxyPhrasesFr)(
    "FR proxy %j matches itself when padded",
    (phrase) => {
      expect(textViolatesPolicy(` ${phrase} `)).toBe(true);
    },
  );

  it("has no duplicate entries within either proxy list", () => {
    expect(new Set(disallowedProxyPhrases).size).toBe(
      disallowedProxyPhrases.length,
    );
    expect(new Set(disallowedProxyPhrasesFr).size).toBe(
      disallowedProxyPhrasesFr.length,
    );
  });
});

// N10.B — the \b -> Unicode lookaround boundary change must keep EN behavior. A
// small corpus pins expected booleans so a future tweak to the boundary logic
// cannot silently change ASCII matching.
describe("N10 EN word-boundary behavior is pinned", () => {
  const cases: Array<[string, boolean]> = [
    ["how old are you?", true],
    ["what is your age", true],
    ["date of birth", true],
    ["do you have children", true],
    ["are you a us citizen", true],
    ["your credit score", true],
    // Must NOT match mid-word (substring would, a boundary must not).
    ["racecar telemetry", false],
    ["the agecap config flag", false],
    // Bare "citizenship" is deliberately not a proxy (only multi-word phrases
    // like "your citizenship status"), so a token match must not over-block.
    ["a citizenship-test parser", false],
    ["passage of time", false],
    ["managed a portfolio of accounts", false],
  ];

  it.each(cases)("textViolatesPolicy(%j) === %s", (text, expected) => {
    expect(textViolatesPolicy(text)).toBe(expected);
  });
});

// N10.B — mustNotFlag corpus: legitimate EN + FR domain questions that share
// surface tokens with protected-topic proxies but are job-related and must all
// return false. Guards against over-blocking regressions.
describe("N10 mustNotFlag legitimate domain corpus", () => {
  const mustNotFlag = [
    // EN
    "Are you legally authorized to work in this country?",
    "Can you perform the essential functions of the job with or without reasonable accommodation?",
    "Describe your experience building cloud-native applications.",
    "How do you manage technical debt across a large codebase?",
    "Walk me through your credit risk modeling track record.",
    "Tell me about supporting a family of products at scale.",
    // FR
    "Quel est l'état de santé d'un système en production que vous avez stabilisé ?",
    "Comment gérez-vous la dette technique du projet ?",
    "Décrivez votre expérience avec une architecture cloud-native.",
    "Êtes-vous autorisé à travailler en France ?",
    "Comment assurez-vous la qualité des soins aux patients ?",
  ];

  it.each(mustNotFlag)("must NOT flag %j", (text) => {
    expect(textViolatesPolicy(text)).toBe(false);
  });
});

describe("French protected-topic proxy coverage", () => {
  const cases: Array<[string, boolean]> = [
    // Real proxies that must be flagged (several start/end with accents).
    ["Pour finir, quel âge avez-vous ?", true],
    ["Avez-vous des enfants en bas âge ?", true],
    ["Êtes-vous enceinte ou prévoyez-vous de l'être ?", true],
    ["Quelle est votre nationalité ?", true],
    ["Êtes-vous français ?", true],
    ["Avez-vous une RQTH ou un problème de santé ?", true],
    ["Combien d'arrêts maladie avez-vous eus l'an dernier ?", true],
    ["Êtes-vous syndiqué ?", true],
    ["Quelles sont vos opinions politiques ?", true],
    ["Avez-vous déjà été condamné ?", true],
    ["Quelle est votre langue maternelle ?", true],
    // Feminine inflection is a separate entry and must also flag.
    ["Êtes-vous mariée ?", true],
    // Legitimate, job-related look-alikes that must NOT be flagged.
    ["Parlez-vous couramment français ?", false],
    // Domain vocabulary must not collide with personal-health/finance proxies.
    ["Quel est l'état de santé du système en production ?", false],
    ["Comment gérez-vous la dette technique du projet ?", false],
    ["Êtes-vous autorisé à travailler en France ?", false],
    ["Avez-vous le permis de conduire B requis pour ce poste ?", false],
    ["Êtes-vous disponible le week-end ?", false],
    ["Décrivez l'origine d'une panne que vous avez diagnostiquée.", false],
    ["Avez-vous déjà configuré une enceinte connectée en production ?", false],
  ];

  it.each(cases)("textViolatesPolicy(%j) === %s", (text, shouldFlag) => {
    expect(textViolatesPolicy(text)).toBe(shouldFlag);
  });
});
