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
//
// v2 IS FROZEN. Nothing renders it any more (the selectors below serve v3), but
// it stays valid for every session already consented under it: the id and the
// four strings it labels are the promise those candidates actually read, so
// they are history, not current copy. Never edit a shipped id in place.
export const candidateDisclosureCopyVersion = "candidate-disclosure-v2";
export const candidateConsentCopyVersion = "candidate-consent-v2";
export const recruiterLimitationCopyVersion = "recruiter-limitation-v1";

// v3 ships as a VARIANT PAIR rather than a single revision, because the promise
// itself differs with the deployment's recording reality: with recording on the
// candidate is told an audio object of their voice is kept for 90 days; with it
// off, that the interview is NOT audio-recorded and their voice is processed in
// real time without being retained. Both variants carry the same 12-month
// transcript + brief horizon, the same rights address, and the same seven-item
// exclusion — only the audio object separates them.
//
// Which variant applies is a SERVER-SIDE fact, resolved once (from
// `RECORDING_ENABLED`) at the same point as the rendering language, so one
// value feeds both the copy the candidate reads and the `consentCopyVersion`
// stamped on their session. An unreadable flag resolves to the no-recording
// pair: fail-closed means describing the smaller processing, never the larger.
export const candidateDisclosureCopyV3Version = "candidate-disclosure-v3";
export const candidateConsentCopyV3Version = "candidate-consent-v3";
export const candidateDisclosureCopyV3NoRecordingVersion =
  "candidate-disclosure-v3-no-recording";
export const candidateConsentCopyV3NoRecordingVersion =
  "candidate-consent-v3-no-recording";

// Audio-consent versions accepted by the recording subsystem: only sessions
// consented under one of these may be audio-recorded (v1 disclosed transcript
// evidence only, not voice capture).
//
// The `-no-recording` ids are deliberately ABSENT, and must never be added. A
// candidate who read that variant was told their voice is not retained, so a
// session stamped with it can never be recorded — whatever any deployment flag
// says afterwards. That is what makes under-disclosure impossible by
// CONSTRUCTION rather than by convention: the recording gate keys on the
// version of the copy the candidate actually read, not on the flag the recorder
// happens to see. A candidate app and a realtime service that disagree about
// `RECORDING_ENABLED` therefore fail CLOSED — no recording, accurate copy —
// instead of capturing someone who was never told.
//
// Mirrored in Go as `audioConsentCopyVersions`
// (services/realtime/internal/application/service.go); the two lists must move
// together, and a Go test pins the mirror.
export const audioRecordingConsentCopyVersions = [
  "candidate-consent-v2",
  "candidate-consent-v3",
] as const;

// The consent copy versions still recognised as a VALID candidate consent —
// what `resolveCandidateConsentGate` checks a stamped session against.
//
// Wider than `audioRecordingConsentCopyVersions` and answering a different
// question: this one asks "did this candidate give a consent we still stand
// behind", the other asks "were they told their voice would be recorded". A
// no-recording consent is perfectly valid; it simply does not authorize audio.
//
// v1 is excluded: it predates the voice disclosure entirely. v2 stays in, frozen,
// because a session consented under it gave a real consent to the same
// candidate-facing flow — dropping it would silently stop recognising sessions
// that were mid-interview when v3 shipped.
export const validCandidateConsentCopyVersions = [
  "candidate-consent-v2",
  "candidate-consent-v3",
  "candidate-consent-v3-no-recording",
] as const;

export const candidateDisclosureCopy =
  "You are speaking with an AI-guided interviewer for a first screening. This interview is audio-recorded so a recruiter can review your answers later. Your answers are reviewed by a recruiter; HireCall does not assess protected attributes, appearance, accent, tone, or emotion.";

export const candidateConsentCopy =
  "I understand that I am joining an AI-guided first-screening interview. An audio recording of my voice, together with a transcript, will be created and stored in the EU as evidence for recruiter review, and may be processed by HireCall's recording provider for that purpose. The recording is kept for up to 90 days and then permanently deleted, and I can request deletion of my recording at any time. HireCall must not assess protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

// French rendering of `candidateDisclosureCopy`. Same version id
// (`candidateDisclosureCopyVersion`, "candidate-disclosure-v2") on purpose: the
// version stamps the COMMITMENTS made to the candidate, and the language is a
// separate recorded fact (`consentLanguage` on the session and the invitation).
// A translation is not a new promise, so it is not a new version — and any
// change to what is promised requires a v3, never an in-place edit of this
// string.
export const candidateDisclosureCopyFr =
  "Vous parlez avec un intervieweur guidé par l'IA, dans le cadre d'une première présélection. Cet entretien est enregistré en audio pour qu'un recruteur puisse consulter vos réponses plus tard. Vos réponses sont revues par un recruteur ; HireCall n'évalue pas les caractéristiques protégées, l'apparence, l'accent, le ton ni les émotions.";

// French rendering of `candidateConsentCopy`. Same version id
// (`candidateConsentCopyVersion`, "candidate-consent-v2") for the same reason as
// the disclosure above: version = commitments, language = separate recorded
// fact. Changing any commitment here — the EU storage location, the 90-day
// retention, the erasure right, or the seven excluded assessment targets —
// requires a v3, never an in-place edit of this string.
export const candidateConsentCopyFr =
  "Je comprends que je participe à un entretien de première présélection guidé par l'IA. Un enregistrement audio de ma voix ainsi qu'une transcription seront créés et stockés dans l'Union européenne, comme éléments consultables pour la revue du recruteur. Ils pourront être traités à cette fin par le prestataire d'enregistrement de HireCall. L'enregistrement est conservé pendant 90 jours au maximum, puis définitivement supprimé. Je peux demander l'effacement de mon enregistrement à tout moment. HireCall ne doit pas évaluer les caractéristiques protégées, l'apparence, l'accent, le ton, les émotions, la personnalité ni les signaux biométriques.";

// --- v3, recording active (`candidate-disclosure-v3` / `candidate-consent-v3`)
//
// Rendered only where `RECORDING_ENABLED` is on. Same version=commitments rule
// as the v2 constants below it: an EN and an FR rendering of the same promises
// share one id, because the language is a separate recorded fact
// (`consentLanguage` on the session and the invitation). A translation is not a
// new promise. Changing any commitment here — the EU storage location, the
// 90-day audio horizon, the 12-month transcript/brief horizon, the erasure
// address, or the seven excluded assessment targets — requires a v4, never an
// in-place edit of this string.
export const candidateDisclosureCopyV3 =
  "You are speaking with an AI-guided interviewer for a first screening. This interview is audio-recorded so a recruiter can review your answers later. Your answers are reviewed by a recruiter; HireCall does not assess protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

// French rendering of `candidateDisclosureCopyV3`, same version id
// (`candidateDisclosureCopyV3Version`) for the reason stated above.
export const candidateDisclosureCopyV3Fr =
  "Vous parlez avec un intervieweur guidé par l'IA, dans le cadre d'une première présélection. Cet entretien est enregistré en audio pour qu'un recruteur puisse consulter vos réponses plus tard. Vos réponses sont revues par un recruteur ; HireCall n'évalue pas les caractéristiques protégées, l'apparence, l'accent, le ton, les émotions, la personnalité ni les signaux biométriques.";

// The consent the candidate ticks where recording is on. Commitments:
// EU-stored audio + transcript, 90-day audio deletion, 12-month transcript and
// brief deletion, erasure on request at privacy@hirecall.ai, and the seven-item
// assessment exclusion. Changing any of them requires a v4.
export const candidateConsentCopyV3 =
  "I understand that I am joining an AI-guided first-screening interview. An audio recording of my voice, together with a transcript, will be created and stored in the EU, as material the recruiter can consult for their review. They may be processed for that purpose by HireCall's recording provider. The recording is kept for up to 90 days and then permanently deleted. The transcript and the recruiter's brief are kept for up to 12 months and then permanently deleted. I can request erasure of my data at any time, at privacy@hirecall.ai. HireCall commits to not assessing protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

// French rendering of `candidateConsentCopyV3`, same version id
// (`candidateConsentCopyV3Version`): version = commitments, language = separate
// recorded fact.
export const candidateConsentCopyV3Fr =
  "Je comprends que je participe à un entretien de première présélection guidé par l'IA. Un enregistrement audio de ma voix ainsi qu'une transcription seront créés et stockés dans l'Union européenne, comme éléments consultables pour la revue du recruteur. Ils pourront être traités à cette fin par le prestataire d'enregistrement de HireCall. L'enregistrement est conservé pendant 90 jours au maximum, puis définitivement supprimé. La transcription et le compte rendu destiné au recruteur sont conservés pendant 12 mois au maximum, puis définitivement supprimés. Je peux demander l'effacement de mes données à tout moment, à l'adresse privacy@hirecall.ai. HireCall s'engage à ne pas évaluer les caractéristiques protégées, l'apparence, l'accent, le ton, les émotions, la personnalité ni les signaux biométriques.";

// --- v3, no recording (`candidate-disclosure-v3-no-recording` /
// `candidate-consent-v3-no-recording`)
//
// The pair that ships as the live one today, since `RECORDING_ENABLED` is
// globally off. It promises LESS than the recording variant, which is exactly
// why its ids are absent from `audioRecordingConsentCopyVersions`: a session
// stamped here can never be recorded. Same version=commitments rule; a v4 is
// required to change what is promised.
export const candidateDisclosureCopyV3NoRecording =
  "You are speaking with an AI-guided interviewer for a first screening. This interview is not audio-recorded; a written transcript of the conversation is created so a recruiter can review your answers later. Your answers are reviewed by a recruiter; HireCall does not assess protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

// French rendering of `candidateDisclosureCopyV3NoRecording`, same version id
// (`candidateDisclosureCopyV3NoRecordingVersion`).
export const candidateDisclosureCopyV3NoRecordingFr =
  "Vous parlez avec un intervieweur guidé par l'IA, dans le cadre d'une première présélection. Cet entretien n'est pas enregistré en audio ; une transcription écrite de la conversation est créée pour qu'un recruteur puisse consulter vos réponses plus tard. Vos réponses sont revues par un recruteur ; HireCall n'évalue pas les caractéristiques protégées, l'apparence, l'accent, le ton, les émotions, la personnalité ni les signaux biométriques.";

// The consent the candidate ticks where recording is off. It does not merely
// drop the audio sentences: it states positively that the interview is not
// audio-recorded and that the voice is processed in real time WITHOUT being
// retained — silence about the voice would be the under-disclosure this variant
// exists to prevent. Commitments: EU-stored transcript, 12-month transcript and
// brief deletion, erasure at privacy@hirecall.ai, seven-item exclusion.
export const candidateConsentCopyV3NoRecording =
  "I understand that I am joining an AI-guided first-screening interview. This interview is not audio-recorded. A written transcript of my answers will be created and stored in the EU, as material the recruiter can consult for their review. My voice is processed in real time to conduct the conversation and produce that transcript; it is not retained. The transcript and the recruiter's brief are kept for up to 12 months and then permanently deleted. I can request erasure of my data at any time, at privacy@hirecall.ai. HireCall commits to not assessing protected attributes, appearance, accent, tone, emotion, personality, or biometric signals.";

// French rendering of `candidateConsentCopyV3NoRecording`, same version id
// (`candidateConsentCopyV3NoRecordingVersion`).
export const candidateConsentCopyV3NoRecordingFr =
  "Je comprends que je participe à un entretien de première présélection guidé par l'IA. Cet entretien n'est pas enregistré en audio. Une transcription écrite de mes réponses sera créée et stockée dans l'Union européenne, comme élément consultable pour la revue du recruteur. Ma voix est traitée en temps réel pour conduire la conversation et produire cette transcription ; elle n'est pas conservée. La transcription et le compte rendu destiné au recruteur sont conservés pendant 12 mois au maximum, puis définitivement supprimés. Je peux demander l'effacement de mes données à tout moment, à l'adresse privacy@hirecall.ai. HireCall s'engage à ne pas évaluer les caractéristiques protégées, l'apparence, l'accent, le ton, les émotions, la personnalité ni les signaux biométriques.";

export const recruiterLimitationCopy =
  "HireCall supports human screening review only. It must not be used as an automated hiring or rejection decision, and it excludes protected traits, appearance, accent, tone, emotion, personality, and biometric signals.";

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

// French mirror of `aiGuardrails` (plan 2026-08-18, rule 1: guardrails anchor
// the published candidate-facing snapshot, so they follow the interview
// language). This is compliance copy: a faithful, one-for-one restatement in the
// same order — never a loose paraphrase, and never reordered, because the
// publication gate matches the whole set.
export const aiGuardrailsFr = [
  "N'analyser que le contenu des réponses du candidat.",
  "Ne pas analyser le visage, l'accent, le ton, les émotions ni les caractéristiques protégées.",
  "Ne prendre aucune décision automatique d'embauche ou de refus.",
  "Laisser la revue finale et les décisions de suivi sous contrôle humain.",
  "Écarter les informations protégées ou sensibles communiquées spontanément lors de la constitution des éléments transmis au recruteur.",
] as const;

// The en/fr catalogue pair for generated content. Declared here rather than
// imported from `@prelude/contracts` because `@prelude/core` deliberately has no
// dependency on the contracts package.
export type GeneratedContentLanguage = "en" | "fr";

/**
 * How a language is NAMED inside an English prompt instruction ("Write every
 * value in French"), which is why the names themselves are English.
 *
 * Not UI copy and never candidate- or recruiter-visible: this is prompt
 * surface, shared by the role-draft generator and the candidate-brief
 * synthesizer so the two output-language directives can never drift apart.
 */
export const promptLanguageNames: Record<GeneratedContentLanguage, string> = {
  en: "English",
  fr: "French",
};

export const sameQuestionOrderGuardrail =
  "Ask every candidate the same questions in the same order.";
export const sameQuestionOrderGuardrailFr =
  "Poser à chaque candidat les mêmes questions, dans le même ordre.";

/**
 * The full guardrail set stamped on an interview plan, in the interview
 * language. Single source for both the deterministic generator and the console's
 * OpenAI normalizer, so a plan can never carry a half-translated set — which the
 * publication gate would reject.
 */
export function getInterviewPlanGuardrails(
  language: GeneratedContentLanguage = "en",
): string[] {
  return language === "fr"
    ? [sameQuestionOrderGuardrailFr, ...aiGuardrailsFr]
    : [sameQuestionOrderGuardrail, ...aiGuardrails];
}

/**
 * A chosen statutory text together with the id that labels its commitments.
 *
 * The two travel as one value on purpose: the caller that renders the copy is
 * the only place that knows which of the four variants the candidate actually
 * read, and the row that records the consent has to say the same thing. Handing
 * back the text alone is what let a stamp drift from a rendering.
 */
export type CandidateCopySelection = {
  text: string;
  version: string;
};

/**
 * The statutory AI disclosure shown on the candidate welcome screen: the
 * language that screen renders in, and the variant that matches what this
 * deployment actually does with the candidate's voice.
 *
 * No default arguments, unlike `getInterviewPlanGuardrails`: a caller that has
 * not decided which language it is rendering has not decided which text the
 * candidate is being asked to read, and a caller that has not resolved
 * `recordingActive` has not decided what they are being asked to agree to.
 * Silently defaulting either is exactly the failure this selector exists to
 * prevent. `recordingActive` is resolved server-side, once, from the
 * deployment's `RECORDING_ENABLED`; a recruiter preview passes `false`, because
 * a preview records nothing whatever the flag says.
 */
export function candidateDisclosureCopyFor(
  language: GeneratedContentLanguage,
  recordingActive: boolean,
): CandidateCopySelection {
  if (recordingActive) {
    return {
      text:
        language === "fr"
          ? candidateDisclosureCopyV3Fr
          : candidateDisclosureCopyV3,
      version: candidateDisclosureCopyV3Version,
    };
  }

  return {
    text:
      language === "fr"
        ? candidateDisclosureCopyV3NoRecordingFr
        : candidateDisclosureCopyV3NoRecording,
    version: candidateDisclosureCopyV3NoRecordingVersion,
  };
}

/**
 * The consent text the candidate ticks, with the version id to stamp on their
 * session. Same two axes as the disclosure, and deliberately the same shape:
 * the two surfaces must never disagree about which processing reality this
 * interview is.
 *
 * The language actually used is recorded separately (`consentLanguage`),
 * because the version id carries commitments, not language.
 */
export function candidateConsentCopyFor(
  language: GeneratedContentLanguage,
  recordingActive: boolean,
): CandidateCopySelection {
  if (recordingActive) {
    return {
      text:
        language === "fr" ? candidateConsentCopyV3Fr : candidateConsentCopyV3,
      version: candidateConsentCopyV3Version,
    };
  }

  return {
    text:
      language === "fr"
        ? candidateConsentCopyV3NoRecordingFr
        : candidateConsentCopyV3NoRecording,
    version: candidateConsentCopyV3NoRecordingVersion,
  };
}

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
    // The prompt context tracks the current FULLEST disclosure regime, not the
    // variant this deployment renders: it anchors what the generator may
    // produce, and the with-recording v3 is the complete commitments set.
    `Candidate disclosure version: ${candidateDisclosureCopyV3Version}.`,
    `Recruiter limitation version: ${recruiterLimitationCopyVersion}.`,
    `Human review boundary: ${humanInLoopRule}`,
    `Recruiter limitation: ${recruiterLimitationCopy}`,
    `Disallowed question and review topics: ${disallowedQuestionTopics.join(", ")}.`,
    `Guardrails: ${aiGuardrails.join(" ")}`,
    `Sensitive information handling: ${sensitiveInformationHandlingRule}`,
  ].join("\n");
}
