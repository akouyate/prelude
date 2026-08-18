import type { WorkspaceLanguage } from "@prelude/contracts";
import {
  recruiterLimitationCopy,
  sensitiveInformationHandlingRule,
} from "@prelude/core";

/**
 * Every recruiter-facing sentence the deterministic candidate brief writes,
 * in both catalogue languages.
 *
 * Plan 2026-08-18, rule 5: the deterministic brief is the production fallback
 * when the LLM call fails or is unconfigured, so it has to speak the workspace
 * language too — a failed call must never silently switch the product back to
 * English. Rule 4 keeps candidate quotes out of this table: they are copied
 * verbatim from the transcript, never rewritten.
 */
export type CandidateBriefCopy = {
  criterionRationale: {
    medium: string;
    noReviewableEvidence: string;
    notAssessable: string;
    strong: string;
    weak: string;
  };
  fact: (quote: string) => string;
  fallbackUsedLimitation: string;
  followUp: (label: string) => string;
  inferredSignalLabel: (label: string) => string;
  limitation: {
    incompleteQuestions: string;
    noCandidateTurns: string;
    recruiterLimitation: string;
    sensitiveExcluded: string;
    sensitiveHandling: string;
    statusNotCompleted: (status: string) => string;
    technicalFailure: string;
  };
  matrixMissingInfo: (label: string) => string;
  missingQuestionsPoint: string;
  notAssessableRisk: string;
  pointToClarify: (label: string) => string;
  recommendationRationale: {
    continueReview: (roleTitle: string) => string;
    inconclusive: (roleTitle: string) => string;
    targetedFollowUp: (roleTitle: string) => string;
  };
  summary: {
    completed: (input: SummaryInput & { turnCount: number }) => string;
    insufficientSignal: (input: SummaryInput) => string;
    noCandidateTurns: (input: SummaryInput) => string;
    partial: (input: SummaryInput & { evidenceStatus: string }) => string;
    technicalFailure: (input: SummaryInput) => string;
  };
};

type SummaryInput = {
  candidateLabel: string;
  roleTitle: string;
};

export function candidateBriefCopy(
  language: WorkspaceLanguage,
): CandidateBriefCopy {
  return briefCopyByLanguage[language];
}

const englishBriefCopy: CandidateBriefCopy = {
  criterionRationale: {
    medium: "Transcript includes relevant but limited evidence.",
    noReviewableEvidence:
      "Candidate speech was captured, but it did not contain reviewable job-related evidence.",
    notAssessable: "Not assessable from the available transcript evidence.",
    strong: "Transcript includes concrete, reviewable evidence.",
    weak: "Transcript evidence is brief and needs recruiter follow-up.",
  },
  fact: (quote) => `Candidate stated: ${quote}`,
  fallbackUsedLimitation:
    "LLM synthesis was unavailable; a conservative local fallback was used.",
  followUp: (label) =>
    `Can you share a concrete example for ${label.toLowerCase()}?`,
  inferredSignalLabel: (label) => `${label} signal`,
  limitation: {
    incompleteQuestions:
      "The interview did not complete every planned question.",
    noCandidateTurns: "No candidate transcript turns were available.",
    recruiterLimitation: recruiterLimitationCopy,
    sensitiveExcluded:
      "Candidate-volunteered protected or sensitive information was excluded from recruiter-facing evidence.",
    sensitiveHandling: sensitiveInformationHandlingRule,
    statusNotCompleted: (status) =>
      `Interview status is ${status}; do not treat this as a full completed screen.`,
    technicalFailure:
      "The interview had a technical failure; do not interpret this as candidate weakness.",
  },
  matrixMissingInfo: (label) =>
    `Clarify ${label.toLowerCase()} with concrete evidence.`,
  missingQuestionsPoint:
    "Confirm the missing interview questions before making a decision.",
  notAssessableRisk:
    "Some criteria are not assessable from reviewable, job-related transcript evidence.",
  pointToClarify: (label) => `Clarify ${label.toLowerCase()}.`,
  recommendationRationale: {
    continueReview: (roleTitle) =>
      `The ${roleTitle} screen contains enough reviewable evidence to continue recruiter review.`,
    inconclusive: (roleTitle) =>
      `The ${roleTitle} screen did not produce enough reviewable evidence for a recruiter recommendation.`,
    targetedFollowUp: (roleTitle) =>
      `The ${roleTitle} screen produced useful signal, but the recruiter should clarify missing details before advancing.`,
  },
  summary: {
    completed: ({ candidateLabel, roleTitle, turnCount }) =>
      `${candidateLabel} completed the ${roleTitle} screen with ${turnCount} candidate transcript turn${turnCount > 1 ? "s" : ""}. Review the cited evidence before deciding the next step.`,
    insufficientSignal: ({ candidateLabel, roleTitle }) =>
      `${candidateLabel}'s ${roleTitle} screen does not contain enough reviewable candidate evidence for a substantive brief. Treat the result as insufficient signal.`,
    noCandidateTurns: ({ candidateLabel, roleTitle }) =>
      `${candidateLabel} completed the ${roleTitle} screen, but the transcript does not contain enough candidate evidence for a substantive brief.`,
    partial: ({ candidateLabel, evidenceStatus, roleTitle }) =>
      `${candidateLabel}'s ${roleTitle} screen is partial (${evidenceStatus}). Review the captured evidence only as directional context before deciding the next human step.`,
    technicalFailure: ({ candidateLabel, roleTitle }) =>
      `${candidateLabel}'s ${roleTitle} screen ended with a technical failure. Use any captured transcript only as context and invite a retry if the profile still matters.`,
  },
};

const frenchBriefCopy: CandidateBriefCopy = {
  // These are re-emitted as `label: rationale` pairs against a maximum-length
  // (120-char) criterion label: Strong/Medium become strengths, capped at 180,
  // and Weak becomes a matrix risk, capped at 220. French is the wordier
  // language, so it is the one that decides how short they have to be.
  criterionRationale: {
    medium: "Éléments pertinents mais limités dans la transcription.",
    noReviewableEvidence:
      "Le candidat s'est exprimé, mais sans élément exploitable pour ce poste.",
    notAssessable: "Non évaluable à partir des éléments de la transcription.",
    strong: "Éléments concrets et exploitables dans la transcription.",
    weak: "Éléments trop brefs ; relance du recruteur requise.",
  },
  fact: (quote) => `Le candidat a déclaré : ${quote}`,
  fallbackUsedLimitation:
    "La synthèse LLM était indisponible ; un repli local, volontairement prudent, a été utilisé.",
  followUp: (label) =>
    `Pouvez-vous donner un exemple concret pour ${label.toLowerCase()} ?`,
  inferredSignalLabel: (label) => `Signal : ${label}`,
  limitation: {
    incompleteQuestions:
      "L'entretien n'a pas couvert toutes les questions prévues.",
    noCandidateTurns: "Aucun tour de parole du candidat n'était disponible.",
    // FR rendering of `recruiterLimitationCopy` / `sensitiveInformationHandlingRule`
    // (@prelude/core, version `recruiter-limitation-v1`), which stay the English
    // source of truth. Same policy statement, same version — only the wording
    // follows the workspace language.
    recruiterLimitation:
      "HireCall n'accompagne qu'une présélection revue par un humain, jamais une décision automatisée d'embauche ou de rejet. Sont exclus : traits protégés, apparence, accent, ton, émotions, personnalité, signaux biométriques.",
    sensitiveExcluded:
      "Les informations protégées ou sensibles communiquées spontanément par le candidat ont été exclues des éléments transmis au recruteur.",
    sensitiveHandling:
      "Si un candidat communique spontanément une information protégée ou sensible, excluez-la de l'évaluation, des recommandations et des justifications ; signalez qu'une information sensible a été écartée pour revue humaine.",
    statusNotCompleted: (status) =>
      `Statut de l'entretien : ${status} ; ne le traitez pas comme une présélection menée à son terme.`,
    technicalFailure:
      "L'entretien a connu une défaillance technique ; n'y voyez pas une faiblesse du candidat.",
  },
  matrixMissingInfo: (label) =>
    `Clarifier ${label.toLowerCase()} avec des éléments concrets.`,
  missingQuestionsPoint:
    "Confirmez les questions d'entretien manquantes avant de décider.",
  notAssessableRisk:
    "Certains critères ne sont pas évaluables à partir d'éléments exploitables et liés au poste.",
  pointToClarify: (label) => `Clarifier ${label.toLowerCase()}.`,
  recommendationRationale: {
    continueReview: (roleTitle) =>
      `La présélection ${roleTitle} contient assez d'éléments exploitables pour poursuivre la revue du recruteur.`,
    inconclusive: (roleTitle) =>
      `La présélection ${roleTitle} n'a pas produit assez d'éléments exploitables pour formuler une recommandation.`,
    targetedFollowUp: (roleTitle) =>
      `La présélection ${roleTitle} a produit des signaux utiles, mais le recruteur doit clarifier les points manquants avant d'aller plus loin.`,
  },
  summary: {
    completed: ({ candidateLabel, roleTitle, turnCount }) =>
      `${candidateLabel} a terminé la présélection ${roleTitle} avec ${turnCount} tour${turnCount > 1 ? "s" : ""} de parole. Vérifiez les éléments cités avant de décider de la suite.`,
    insufficientSignal: ({ candidateLabel, roleTitle }) =>
      `La présélection ${roleTitle} de ${candidateLabel} ne contient pas assez d'éléments exploitables pour un compte rendu argumenté. Traitez ce résultat comme un signal insuffisant.`,
    noCandidateTurns: ({ candidateLabel, roleTitle }) =>
      `${candidateLabel} a terminé la présélection ${roleTitle}, mais la transcription ne contient pas assez d'éléments pour un compte rendu argumenté.`,
    partial: ({ candidateLabel, evidenceStatus, roleTitle }) =>
      `La présélection ${roleTitle} de ${candidateLabel} est partielle (${evidenceStatus}). Ne lisez les éléments captés que comme un indice avant de décider de la prochaine étape humaine.`,
    technicalFailure: ({ candidateLabel, roleTitle }) =>
      `La présélection ${roleTitle} de ${candidateLabel} s'est terminée sur une défaillance technique. N'utilisez la transcription captée que comme contexte, et proposez un nouvel essai si le profil reste intéressant.`,
  },
};

const briefCopyByLanguage: Record<WorkspaceLanguage, CandidateBriefCopy> = {
  en: englishBriefCopy,
  fr: frenchBriefCopy,
};
