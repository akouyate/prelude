import { describe, expect, it } from "vitest";

import {
  aiGuardrails,
  audioRecordingConsentCopyVersions,
  buildAiCompliancePromptContext,
  candidateConsentCopy,
  candidateConsentCopyFor,
  candidateConsentCopyFr,
  candidateConsentCopyVersion,
  candidateConsentCopyV3,
  candidateConsentCopyV3Fr,
  candidateConsentCopyV3NoRecording,
  candidateConsentCopyV3NoRecordingFr,
  candidateConsentCopyV3NoRecordingVersion,
  candidateConsentCopyV3Version,
  candidateDisclosureCopy,
  candidateDisclosureCopyFor,
  candidateDisclosureCopyFr,
  candidateDisclosureCopyVersion,
  candidateDisclosureCopyV3,
  candidateDisclosureCopyV3Fr,
  candidateDisclosureCopyV3NoRecording,
  candidateDisclosureCopyV3NoRecordingFr,
  candidateDisclosureCopyV3NoRecordingVersion,
  candidateDisclosureCopyV3Version,
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
  validCandidateConsentCopyVersions,
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
    expect(audioRecordingConsentCopyVersions).toContain(
      candidateConsentCopyVersion,
    );
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
    // Pinned with the trailing period so the no-recording variant cannot
    // satisfy it by prefix.
    expect(promptContext).toContain(
      "Candidate disclosure version: candidate-disclosure-v3.",
    );
  });

  it("detects risky automated-decision wording", () => {
    expect(
      findForbiddenAutomatedDecisionPhrases(
        "Move only qualified profiles forward after a candidate score.",
      ),
    ).toEqual(["qualified profiles", "candidate score"]);
    expect(
      findForbiddenAutomatedDecisionPhrases(
        "HireCall supports human screening review only.",
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
    [
      "Can you work the required schedule, including occasional weekends?",
      false,
    ],
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

describe("French candidate consent surface", () => {
  it("keeps the French disclosure a faithful restatement of the English one", () => {
    // Meaning parity, not word parity: the FR text has to carry the same three
    // commitments as `candidateDisclosureCopy` — AI-guided first screening,
    // audio recording for later recruiter review, and the exclusion of
    // protected attributes.
    expect(candidateDisclosureCopyFr).toContain("guidé par l'IA");
    expect(candidateDisclosureCopyFr).toContain("première présélection");
    expect(candidateDisclosureCopyFr).toContain("enregistré en audio");
    expect(candidateDisclosureCopyFr).toContain("revues par un recruteur");
    expect(candidateDisclosureCopyFr).toContain("caractéristiques protégées");
  });

  it("keeps every commitment of the French consent text", () => {
    expect(candidateConsentCopyFr).toContain("caractéristiques protégées");
    expect(candidateConsentCopyFr).toContain("Union européenne");
    expect(candidateConsentCopyFr).toContain("90 jours");
    expect(candidateConsentCopyFr).toContain("effacement");
    expect(candidateConsentCopyFr).toContain("enregistrement audio");
    expect(candidateConsentCopyFr).toContain("transcription");
  });

  it("excludes the same seven assessment targets as the English consent", () => {
    // The English consent excludes: protected attributes, appearance, accent,
    // tone, emotion, personality, biometric signals. All seven must survive the
    // French rendering — a missing one is a narrower promise, not a translation
    // nuance.
    [
      "caractéristiques protégées",
      "l'apparence",
      "l'accent",
      "le ton",
      "les émotions",
      "la personnalité",
      "les signaux biométriques",
    ].forEach((exclusion) => {
      expect(candidateConsentCopyFr).toContain(exclusion);
    });
  });

  it("keeps the French copy on the same version ids as the English copy", () => {
    // The version stamps commitments, never language: an FR rendering of the
    // same promises is still candidate-disclosure-v2 / candidate-consent-v2.
    expect(candidateDisclosureCopyVersion).toBe("candidate-disclosure-v2");
    expect(candidateConsentCopyVersion).toBe("candidate-consent-v2");
  });

  it("keeps the v2 texts frozen even though nothing renders them any more", () => {
    // The selectors now serve the v3 variant pair (see the v3 suite below), so
    // these four strings are history: they are the copy already-consented
    // sessions were shown, and their bytes must never move. Reachable, not
    // rendered.
    expect(candidateDisclosureCopy).toContain("audio-recorded");
    expect(candidateDisclosureCopyFr).toContain("enregistré en audio");
    expect(candidateConsentCopy).toContain("HireCall must not assess");
    expect(candidateConsentCopyFr).toContain("HireCall ne doit pas évaluer");
  });

  it("keeps the French texts single-line and free of typographic apostrophes", () => {
    // The sibling FR policy constants are single-line strings with straight
    // apostrophes; a smart quote here would silently break byte-equality with
    // the legally reviewed text.
    [candidateDisclosureCopyFr, candidateConsentCopyFr].forEach((copy) => {
      expect(copy).not.toContain("\n");
      expect(copy).not.toContain("’");
    });
  });
});

describe("v3 statutory copy — the recording variant pair", () => {
  const consents = [
    candidateConsentCopyV3,
    candidateConsentCopyV3Fr,
    candidateConsentCopyV3NoRecording,
    candidateConsentCopyV3NoRecordingFr,
  ];
  const recordingPair = [
    candidateDisclosureCopyV3,
    candidateDisclosureCopyV3Fr,
    candidateConsentCopyV3,
    candidateConsentCopyV3Fr,
  ];
  const noRecordingPair = [
    candidateDisclosureCopyV3NoRecording,
    candidateDisclosureCopyV3NoRecordingFr,
    candidateConsentCopyV3NoRecording,
    candidateConsentCopyV3NoRecordingFr,
  ];

  it("ships four ids, one per processing reality and none of them a v2 edit", () => {
    expect(candidateDisclosureCopyV3Version).toBe("candidate-disclosure-v3");
    expect(candidateConsentCopyV3Version).toBe("candidate-consent-v3");
    expect(candidateDisclosureCopyV3NoRecordingVersion).toBe(
      "candidate-disclosure-v3-no-recording",
    );
    expect(candidateConsentCopyV3NoRecordingVersion).toBe(
      "candidate-consent-v3-no-recording",
    );
    // v2 is frozen, not replaced: already-consented sessions keep their id.
    expect(candidateDisclosureCopyVersion).toBe("candidate-disclosure-v2");
    expect(candidateConsentCopyVersion).toBe("candidate-consent-v2");
  });

  it("prints the rights address and the 12-month horizon in every consent", () => {
    // Art. 13(2)(a)+(b): a retention period and a working address for exercising
    // erasure. Both variants keep the transcript + brief horizon; only the audio
    // object differs between them.
    consents.forEach((copy) => {
      expect(copy).toContain("privacy@hirecall.ai");
    });
    expect(candidateConsentCopyV3).toContain("up to 12 months");
    expect(candidateConsentCopyV3NoRecording).toContain("up to 12 months");
    expect(candidateConsentCopyV3Fr).toContain("12 mois");
    expect(candidateConsentCopyV3NoRecordingFr).toContain("12 mois");
  });

  it("promises the 90-day audio horizon only where audio is actually kept", () => {
    // The horizon is a consent commitment; the disclosure only announces that
    // the interview IS audio-recorded. Neither appears in the no-recording pair.
    expect(candidateConsentCopyV3).toContain("90 days");
    expect(candidateConsentCopyV3Fr).toContain("90 jours");
    expect(candidateDisclosureCopyV3).toContain("is audio-recorded");
    expect(candidateDisclosureCopyV3Fr).toContain("est enregistré en audio");
    noRecordingPair.forEach((copy) => {
      expect(copy).not.toContain("90");
    });
  });

  it("tells the no-recording candidate their voice is not retained", () => {
    expect(candidateDisclosureCopyV3NoRecording).toContain(
      "not audio-recorded",
    );
    expect(candidateConsentCopyV3NoRecording).toContain("not audio-recorded");
    expect(candidateDisclosureCopyV3NoRecordingFr).toContain(
      "n'est pas enregistré en audio",
    );
    expect(candidateConsentCopyV3NoRecordingFr).toContain(
      "n'est pas enregistré en audio",
    );
    // The real-time voice sentence is what keeps the no-recording variant
    // honest: the voice IS processed, it is simply not retained.
    expect(candidateConsentCopyV3NoRecording).toContain(
      "My voice is processed in real time",
    );
    expect(candidateConsentCopyV3NoRecording).toContain("it is not retained");
    expect(candidateConsentCopyV3NoRecordingFr).toContain(
      "Ma voix est traitée en temps réel",
    );
    expect(candidateConsentCopyV3NoRecordingFr).toContain(
      "elle n'est pas conservée",
    );
    // The with-recording variant must never carry the no-recording claim.
    recordingPair.forEach((copy) => {
      expect(copy).not.toContain("not audio-recorded");
      expect(copy).not.toContain("n'est pas enregistré");
    });
  });

  it("keeps the seven-item exclusion, as a commitment, in every consent", () => {
    // v2 said "must not assess" / "ne doit pas évaluer" (a rule imposed on
    // HireCall); v3 says HireCall COMMITS to not assessing — the same seven
    // targets, restated as an undertaking to the candidate.
    [candidateConsentCopyV3, candidateConsentCopyV3NoRecording].forEach(
      (copy) => {
        expect(copy).toContain("HireCall commits to not assessing");
        [
          "protected attributes",
          "appearance",
          "accent",
          "tone",
          "emotion",
          "personality",
          "biometric signals",
        ].forEach((exclusion) => {
          expect(copy).toContain(exclusion);
        });
      },
    );

    [candidateConsentCopyV3Fr, candidateConsentCopyV3NoRecordingFr].forEach(
      (copy) => {
        expect(copy).toContain("HireCall s'engage à ne pas évaluer");
        [
          "caractéristiques protégées",
          "l'apparence",
          "l'accent",
          "le ton",
          "les émotions",
          "la personnalité",
          "les signaux biométriques",
        ].forEach((exclusion) => {
          expect(copy).toContain(exclusion);
        });
      },
    );
  });

  it("keeps every v3 text single-line with straight apostrophes", () => {
    // A legal sign-off re-verifies these by hash: a smart quote or a wrapped
    // line silently breaks byte-equality with the reviewed text.
    [...recordingPair, ...noRecordingPair].forEach((copy) => {
      expect(copy).not.toContain("\n");
      expect(copy).not.toContain("\u2019");
      expect(copy.trim()).toBe(copy);
    });
  });

  it("selects one of eight texts from the language and the recording reality", () => {
    expect(candidateDisclosureCopyFor("en", true)).toEqual({
      text: candidateDisclosureCopyV3,
      version: candidateDisclosureCopyV3Version,
    });
    expect(candidateDisclosureCopyFor("fr", true)).toEqual({
      text: candidateDisclosureCopyV3Fr,
      version: candidateDisclosureCopyV3Version,
    });
    expect(candidateDisclosureCopyFor("en", false)).toEqual({
      text: candidateDisclosureCopyV3NoRecording,
      version: candidateDisclosureCopyV3NoRecordingVersion,
    });
    expect(candidateDisclosureCopyFor("fr", false)).toEqual({
      text: candidateDisclosureCopyV3NoRecordingFr,
      version: candidateDisclosureCopyV3NoRecordingVersion,
    });

    expect(candidateConsentCopyFor("en", true)).toEqual({
      text: candidateConsentCopyV3,
      version: candidateConsentCopyV3Version,
    });
    expect(candidateConsentCopyFor("fr", true)).toEqual({
      text: candidateConsentCopyV3Fr,
      version: candidateConsentCopyV3Version,
    });
    expect(candidateConsentCopyFor("en", false)).toEqual({
      text: candidateConsentCopyV3NoRecording,
      version: candidateConsentCopyV3NoRecordingVersion,
    });
    expect(candidateConsentCopyFor("fr", false)).toEqual({
      text: candidateConsentCopyV3NoRecordingFr,
      version: candidateConsentCopyV3NoRecordingVersion,
    });

    // Eight distinct texts, four distinct version ids: no variant may collapse
    // into another, or a candidate would be stamped with copy they never read.
    const texts = new Set(
      (["en", "fr"] as const).flatMap((language) =>
        [true, false].flatMap((recordingActive) => [
          candidateDisclosureCopyFor(language, recordingActive).text,
          candidateConsentCopyFor(language, recordingActive).text,
        ]),
      ),
    );
    expect(texts.size).toBe(8);
  });

  it("keeps the recording allowlist a strict subset of the valid consent ids", () => {
    // Direction is the whole point. An id that authorizes RECORDING while not
    // being a valid consent is a recording with no legal basis behind it; the
    // reverse is intended and harmless — a no-recording consent is perfectly
    // valid, it simply does not authorize audio. Guard the direction that kills
    // the basis.
    expect(
      audioRecordingConsentCopyVersions.filter(
        (version) => !validCandidateConsentCopyVersions.includes(version),
      ),
    ).toEqual([]);

    // Non-vacuous: both lists have entries, and the subset is STRICT, so this
    // is not two names for one list agreeing with itself.
    expect(audioRecordingConsentCopyVersions.length).toBeGreaterThan(0);
    expect(validCandidateConsentCopyVersions.length).toBeGreaterThan(
      audioRecordingConsentCopyVersions.length,
    );
  });

  it("keeps every no-recording id out of the recording allowlist", () => {
    expect(
      audioRecordingConsentCopyVersions.filter((version) =>
        version.includes("no-recording"),
      ),
    ).toEqual([]);

    // Non-vacuous: such an id exists, and it IS a valid consent — so the empty
    // result above is the allowlist excluding it, not the id being absent
    // everywhere.
    expect(
      validCandidateConsentCopyVersions.filter((version) =>
        version.includes("no-recording"),
      ),
    ).toEqual(["candidate-consent-v3-no-recording"]);
  });

  it("never lets a no-recording consent into the recording allowlist", () => {
    // The gate keys on the version of the copy the candidate actually read, so
    // under-disclosure is impossible by construction: a candidate told they are
    // not audio-recorded carries an id the recorder does not accept.
    expect([...audioRecordingConsentCopyVersions]).toEqual([
      "candidate-consent-v2",
      "candidate-consent-v3",
    ]);
    expect(audioRecordingConsentCopyVersions).toContain(
      candidateConsentCopyV3Version,
    );
    expect(audioRecordingConsentCopyVersions).not.toContain(
      candidateConsentCopyV3NoRecordingVersion,
    );
    expect(audioRecordingConsentCopyVersions).not.toContain(
      candidateDisclosureCopyV3NoRecordingVersion,
    );
  });
});
