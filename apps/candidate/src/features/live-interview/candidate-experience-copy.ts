import type { WorkspaceLanguage } from "@prelude/contracts";

/**
 * Every candidate-facing sentence on the pre-join surfaces — the welcome
 * (disclosure) screen, the setup (consent) screen — plus the withdrawal surface
 * the consent implies (the in-interview Quit control and the panel it leads to).
 *
 * Plan 2026-08-18, rule 1: candidate-bound content follows the INTERVIEW
 * language, so this table is keyed by the language the server resolved for this
 * interview, never by the reader or by a browser header.
 *
 * A copy table rather than i18next: this app carries no i18n runtime, and the
 * surface is a fixed, legally-reviewed set of sentences rather than an open
 * catalogue. Mirrors `apps/console/src/server/interviews/candidate-brief-copy.ts`.
 *
 * The statutory disclosure and consent texts themselves live in `@prelude/core`
 * (`candidateDisclosureCopyFor` / `candidateConsentCopyFor`) and deliberately do
 * NOT appear here: they are versioned compliance copy, not UI copy. The one
 * exception by legal ruling R5.1 is `listeningNote*`, the fragment that closes
 * the disclosure paragraph in the markup — it is copy, so it lives here, which
 * is exactly what keeps the reviewed text in core byte-exact.
 *
 * Everything else in the live interview room stays English for now (announced
 * follow-up); only the consent surface is localized.
 */
export type CandidateExperienceCopy = {
  abandonedBody: (companyName: string) => string;
  abandonedClosing: string;
  abandonedRetry: string;
  abandonedTitle: string;
  answersBody: string;
  answersTitle: string;
  audioBlockedBody: string;
  audioBlockedEnable: string;
  audioBlockedTitle: string;
  audioOnlyNotice: string;
  back: string;
  /**
   * GDPR art. 13 layer 1 (legal ruling, issue #161): the two-sentence
   * controller statement rendered under the disclosure paragraph, followed by
   * `privacyNoticeLink` pointing at the layer-2 notice.
   */
  controllerLine: (companyName: string) => string;
  durationLong: (minutes: number) => string;
  durationShort: (minutes: number) => string;
  durationUnknown: string;
  emailLabel: string;
  emailOptional: string;
  emailPlaceholder: string;
  evidenceBody: string;
  evidenceTitle: string;
  fairnessHeading: string;
  fairnessKicker: string;
  formatLabel: string;
  headerPill: string;
  humanReviewedPill: string;
  introDescription: (input: {
    companyName: string;
    roleTitle: string;
  }) => string;
  introHeading: string;
  introPill: string;
  invitation: (companyName: string) => string;
  lengthLabel: string;
  listeningNoteEmphasis: string;
  listeningNoteLead: string;
  modeAudio: string;
  modeFormFallback: string;
  marketingAnswersBody: string;
  marketingAnswersTitle: string;
  marketingConsentCopy: string;
  marketingControllerLine: string;
  marketingDisclosureCopy: string;
  marketingEvidenceBody: string;
  marketingEvidenceTitle: string;
  marketingHeaderPill: string;
  marketingHumanReviewedPill: string;
  marketingIntroDescription: string;
  marketingInvitation: string;
  marketingStart: string;
  nameLabel: string;
  namePlaceholder: string;
  paceBody: string;
  paceTitle: string;
  preflightHeading: string;
  preflightSubtitle: (input: {
    jobTitle: string;
    minutes: number | null;
  }) => string;
  previewConsentCopy: string;
  previewDisclosureCopy: string;
  previewEvidenceBody: string;
  previewEvidenceTitle: string;
  previewIntroDescription: string;
  previewStart: string;
  privacyNoticeLink: string;
  privacyPill: string;
  quit: string;
  roleLabel: string;
  startButton: string;
  startConsentRequired: string;
  startFootnote: string;
  startJoin: string;
  startNameRequired: string;
  writtenFallback: string;
};

export function candidateExperienceCopy(
  language: WorkspaceLanguage,
): CandidateExperienceCopy {
  return candidateCopyByLanguage[language];
}

const englishCandidateCopy: CandidateExperienceCopy = {
  abandonedBody: (companyName) =>
    `We stopped this attempt and did not mark it as complete. If that was accidental, you can start a new attempt for ${companyName}.`,
  abandonedClosing:
    "You can also close this window and use the latest link from the recruiter.",
  abandonedRetry: "Start a new attempt",
  abandonedTitle: "Interview ended",
  answersBody: "Only the content of your answers reaches the recruiter.",
  answersTitle: "Answers, not appearance",
  audioBlockedBody: "Tap once to hear the interviewer on this device.",
  audioBlockedEnable: "Enable audio",
  audioBlockedTitle: "Audio paused by your browser",
  audioOnlyNotice:
    "This interview is audio-first. You only need your microphone.",
  back: "Back",
  controllerLine: (companyName) =>
    `This interview is run for ${companyName}, the data controller. HireCall conducts it on their behalf.`,
  durationLong: (minutes) => `About ${minutes} minutes`,
  durationShort: (minutes) => `About ${minutes} min`,
  durationUnknown: "A few minutes",
  emailLabel: "Email",
  emailOptional: "optional",
  emailPlaceholder: "you@example.com",
  evidenceBody:
    "Your words are saved as transcript evidence for recruiter review.",
  evidenceTitle: "Transcribed for review",
  fairnessHeading: "Fair, calm, and transparent.",
  fairnessKicker: "How this interview works",
  formatLabel: "Format",
  headerPill: "Candidate interview",
  humanReviewedPill: "Human reviewed",
  introDescription: ({ companyName, roleTitle }) =>
    `${roleTitle} at ${companyName}. Answer naturally; the recruiter reviews your answers, not your face, accent, tone, emotion, or protected attributes.`,
  introHeading: "Let's get you ready",
  introPill: "Private first screen",
  invitation: (companyName) =>
    `${companyName} invites you to a first conversation`,
  lengthLabel: "Length",
  listeningNoteEmphasis: "what you say",
  listeningNoteLead: "We listen to",
  modeAudio: "audio",
  modeFormFallback: "form fallback",
  marketingAnswersBody:
    "Your answers are used only for this private practice result and never enter a recruiter workspace.",
  marketingAnswersTitle: "Practice, not an application",
  marketingConsentCopy:
    "I agree to live microphone processing for this demo. Audio is not recorded. A transcript is processed and retained temporarily to run the interview and create my one-time result, then deleted after handoff or automatic expiry.",
  marketingControllerLine:
    "HireCall is the data controller for this public demo. Processing consent is required for the interview; any later marketing-email choice is separate and optional.",
  marketingDisclosureCopy:
    "You are trying HireCall through a real candidate-style AI voice interview. Your audio is not recorded; a temporary transcript powers the conversation and your one-time personalized result.",
  marketingEvidenceBody:
    "A temporary transcript is processed during the demo and deleted after its one-use handoff or automatic expiry.",
  marketingEvidenceTitle: "Temporary processing",
  marketingHeaderPill: "Practice interview",
  marketingHumanReviewedPill: "No candidate profile",
  marketingIntroDescription:
    "Answer naturally, as you would in a real first interview. This demo stays outside every recruiter workspace.",
  marketingInvitation: "Try the candidate experience for yourself",
  marketingStart: "Start my interview",
  nameLabel: "Your name",
  namePlaceholder: "Your name",
  paceBody: "There is no timer on answers. Pause and think.",
  paceTitle: "Go at your own pace",
  preflightHeading: "Before you start",
  preflightSubtitle: ({ jobTitle, minutes }) =>
    minutes ? `${jobTitle} · about ${minutes} minutes` : jobTitle,
  previewConsentCopy:
    "I understand that this is a recruiter live test. My microphone audio is transmitted to the AI interviewer but is not recorded. A transcript is retained temporarily for the live runtime, then automatically deleted; nothing is evaluated as a candidate or added to the candidate pipeline.",
  previewDisclosureCopy:
    "You are viewing the real candidate experience in recruiter preview mode. Nothing is added to your candidate pipeline. You can continue to run a live test with the interviewer.",
  previewEvidenceBody:
    "A temporary transcript powers this live test and never enters the candidate pipeline.",
  previewEvidenceTitle: "Temporary live-test transcript",
  previewIntroDescription:
    "This is the same setup candidates see. Your test answers stay outside the candidate pipeline.",
  previewStart: "Start live test",
  privacyNoticeLink: "Read the privacy notice",
  privacyPill: "Private interview",
  quit: "Quit",
  roleLabel: "Role",
  startButton: "Get started",
  startConsentRequired: "Accept consent to join",
  startFootnote: "No account needed · Take your time on every answer",
  startJoin: "Join the interview",
  startNameRequired: "Enter your name to join",
  writtenFallback: "Use written fallback",
};

// Vouvoiement throughout: the candidate is a stranger being screened, and the
// French statutory texts in `@prelude/core` address them the same way.
const frenchCandidateCopy: CandidateExperienceCopy = {
  abandonedBody: (companyName) =>
    `Nous avons interrompu cette tentative sans la marquer comme terminée. Si c'était involontaire, vous pouvez démarrer une nouvelle tentative pour ${companyName}.`,
  abandonedClosing:
    "Vous pouvez aussi fermer cette fenêtre et utiliser le dernier lien envoyé par le recruteur.",
  abandonedRetry: "Démarrer une nouvelle tentative",
  abandonedTitle: "Entretien interrompu",
  answersBody: "Seul le contenu de vos réponses parvient au recruteur.",
  answersTitle: "Vos réponses, pas votre apparence",
  audioBlockedBody:
    "Touchez une fois l'écran pour entendre l'intervieweur sur cet appareil.",
  audioBlockedEnable: "Activer l'audio",
  audioBlockedTitle: "Audio suspendu par votre navigateur",
  audioOnlyNotice:
    "Cet entretien se déroule à la voix. Vous n'avez besoin que de votre microphone.",
  back: "Retour",
  controllerLine: (companyName) =>
    `Cet entretien est mené pour ${companyName}, responsable du traitement de vos données. HireCall le conduit pour son compte.`,
  durationLong: (minutes) => `Environ ${minutes} minutes`,
  durationShort: (minutes) => `Environ ${minutes} min`,
  durationUnknown: "Quelques minutes",
  emailLabel: "E-mail",
  emailOptional: "facultatif",
  emailPlaceholder: "vous@exemple.com",
  evidenceBody:
    "Vos propos sont conservés sous forme de transcription, consultable par le recruteur.",
  evidenceTitle: "Transcrit pour la revue",
  fairnessHeading: "Équitable, posé et transparent.",
  fairnessKicker: "Comment se déroule cet entretien",
  formatLabel: "Format",
  headerPill: "Entretien candidat",
  humanReviewedPill: "Revu par un humain",
  introDescription: ({ companyName, roleTitle }) =>
    `${roleTitle} chez ${companyName}. Répondez naturellement : le recruteur examine vos réponses, pas votre visage, votre accent, votre ton, vos émotions ni vos caractéristiques protégées.`,
  introHeading: "Préparons votre entretien",
  introPill: "Premier échange confidentiel",
  invitation: (companyName) =>
    `${companyName} vous invite à un premier échange`,
  lengthLabel: "Durée",
  listeningNoteEmphasis: "ce que vous dites",
  listeningNoteLead: "Nous écoutons",
  modeAudio: "audio",
  modeFormFallback: "réponses écrites",
  marketingAnswersBody:
    "Vos réponses servent uniquement à ce résultat d'entraînement privé et n'entrent jamais dans un espace recruteur.",
  marketingAnswersTitle: "Un entraînement, pas une candidature",
  marketingConsentCopy:
    "J'accepte le traitement en direct de mon microphone pour cette démo. Le son n'est pas enregistré. Une transcription est traitée et conservée temporairement pour mener l'entretien et créer mon résultat à usage unique, puis supprimée après le transfert ou l'expiration automatique.",
  marketingControllerLine:
    "HireCall est responsable du traitement pour cette démo publique. Le consentement au traitement est requis pour l'entretien ; tout choix ultérieur d'e-mail marketing est distinct et facultatif.",
  marketingDisclosureCopy:
    "Vous essayez HireCall dans un véritable entretien vocal avec IA, comme un candidat. Le son n'est pas enregistré ; une transcription temporaire alimente l'échange et votre résultat personnalisé à usage unique.",
  marketingEvidenceBody:
    "Une transcription temporaire est traitée pendant la démo, puis supprimée après son transfert à usage unique ou son expiration automatique.",
  marketingEvidenceTitle: "Traitement temporaire",
  marketingHeaderPill: "Entretien d'entraînement",
  marketingHumanReviewedPill: "Aucun profil candidat",
  marketingIntroDescription:
    "Répondez naturellement, comme lors d'un premier entretien. Cette démo reste en dehors de tout espace recruteur.",
  marketingInvitation: "Essayez vous-même l'expérience candidat",
  marketingStart: "Commencer mon entretien",
  nameLabel: "Votre nom",
  namePlaceholder: "Votre nom",
  paceBody: "Aucun chronomètre sur vos réponses. Prenez le temps de réfléchir.",
  paceTitle: "Avancez à votre rythme",
  preflightHeading: "Avant de commencer",
  preflightSubtitle: ({ jobTitle, minutes }) =>
    minutes ? `${jobTitle} · environ ${minutes} minutes` : jobTitle,
  previewConsentCopy:
    "Je comprends qu'il s'agit d'un test en direct côté recruteur. Le son de mon microphone est transmis à l'intervieweur IA, mais n'est pas enregistré. Une transcription est conservée temporairement pendant l'exécution, puis supprimée automatiquement ; rien n'est évalué comme une candidature ni ajouté au vivier de candidats.",
  previewDisclosureCopy:
    "Vous consultez l'expérience candidat réelle en mode aperçu recruteur. Rien n'est ajouté à votre vivier de candidats. Vous pouvez poursuivre pour lancer un test en direct avec l'intervieweur.",
  previewEvidenceBody:
    "Une transcription temporaire alimente ce test en direct et n'entre jamais dans le vivier de candidats.",
  previewEvidenceTitle: "Transcription temporaire de test",
  previewIntroDescription:
    "Voici exactement l'écran que voient les candidats. Vos réponses de test restent en dehors du vivier de candidats.",
  previewStart: "Lancer le test en direct",
  privacyNoticeLink: "Consulter la notice de confidentialité",
  privacyPill: "Entretien confidentiel",
  quit: "Quitter",
  roleLabel: "Poste",
  startButton: "Commencer",
  startConsentRequired: "Acceptez le consentement pour rejoindre",
  startFootnote: "Aucun compte requis · Prenez votre temps à chaque réponse",
  startJoin: "Rejoindre l'entretien",
  startNameRequired: "Saisissez votre nom pour rejoindre",
  writtenFallback: "Répondre par écrit",
};

const candidateCopyByLanguage: Record<
  WorkspaceLanguage,
  CandidateExperienceCopy
> = {
  en: englishCandidateCopy,
  fr: frenchCandidateCopy,
};
