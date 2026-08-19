import type { WorkspaceLanguage } from "@prelude/contracts";

/**
 * The candidate privacy notice (GDPR art. 13 layer 2), as structured data.
 *
 * The wording is statutory: it was ruled on by legal (issue #161) and lands here
 * MEANING-EXACT — same sections, same order, same sentences. Only two things
 * became code: the `{companyName}` / `{updatedDate}` slots, and the entries the
 * ruling marked `[RECORDING]`, which appear only when audio recording is
 * actually on for this deployment (`isRecordingActive`, server-side).
 *
 * Sections rather than a markdown blob so the recording gating is a property of
 * an entry instead of a regex over prose, so the two languages can be compared
 * structurally in a test, and so the renderer owns the typography.
 *
 * Language follows the recipient (plan 2026-08-18, rule 1): the notice renders
 * in the INTERVIEW's language — the same `resolveCandidateRenderingLanguage`
 * value the consent screens use — never in the reader's browser language.
 * One language for the whole candidate surface.
 */

/**
 * Bump when the notice text changes — it is what the notice prints as its own
 * "last updated", and a candidate comparing two versions has nothing else to go
 * on. Not a build date: an unchanged notice must keep an unchanged date.
 */
export const NOTICE_UPDATED_DATE = "2026-08-19";

export type PrivacyNoticeBullet = {
  /** Nested bullets, e.g. the named subprocessors under "who has access". */
  items?: PrivacyNoticeBullet[];
  text: string;
};

export type PrivacyNoticeBlock =
  | { items: PrivacyNoticeBullet[]; kind: "list" }
  | { kind: "paragraph"; text: string };

export type PrivacyNoticeSection = {
  blocks: PrivacyNoticeBlock[];
  heading: string;
  /** Language-independent identity, so the two tables can be compared. */
  id: PrivacyNoticeSectionId;
};

export type CandidatePrivacyNotice = {
  lastUpdated: string;
  sections: PrivacyNoticeSection[];
  title: string;
};

export type PrivacyNoticeSectionId =
  | "access"
  | "controller"
  | "legal-bases"
  | "retention"
  | "rights"
  | "stopping"
  | "what-we-process";

/**
 * Template layer: what the ruling wrote, with its `[RECORDING]` markers intact.
 * `candidatePrivacyNotice` resolves it into the flat shape above.
 */
type PrivacyNoticeBulletTemplate = {
  items?: PrivacyNoticeBulletTemplate[];
  /** `[RECORDING]`: dropped entirely when the recording is off. */
  recordingOnly?: boolean;
  text: string;
};

type PrivacyNoticeBlockTemplate =
  | { items: PrivacyNoticeBulletTemplate[]; kind: "list" }
  | {
      kind: "paragraph";
      /**
       * The one `[RECORDING]` marker that sits MID-sentence (the rights
       * enumeration): spliced between `text` and `textEnd` when the recording
       * is on. With it off, `text` + `textEnd` is a complete sentence — the
       * enumeration closes instead of trailing a dangling clause.
       */
      recordingClause?: string;
      recordingOnly?: boolean;
      text: string;
      textEnd?: string;
    };

type PrivacyNoticeSectionTemplate = {
  blocks: PrivacyNoticeBlockTemplate[];
  heading: string;
  id: PrivacyNoticeSectionId;
};

type PrivacyNoticeTemplate = {
  lastUpdated: string;
  sections: PrivacyNoticeSectionTemplate[];
  title: string;
};

export function candidatePrivacyNotice({
  companyName,
  language,
  recordingActive,
}: {
  companyName: string;
  language: WorkspaceLanguage;
  recordingActive: boolean;
}): CandidatePrivacyNotice {
  const template = privacyNoticeByLanguage[language];
  const fill = (value: string) =>
    value
      .replaceAll("{companyName}", companyName)
      .replaceAll("{updatedDate}", NOTICE_UPDATED_DATE);

  const resolveBullets = (
    bullets: PrivacyNoticeBulletTemplate[],
  ): PrivacyNoticeBullet[] =>
    bullets
      .filter((bullet) => recordingActive || !bullet.recordingOnly)
      .map((bullet) => {
        const items = bullet.items ? resolveBullets(bullet.items) : undefined;
        return items ? { items, text: fill(bullet.text) } : { text: fill(bullet.text) };
      });

  return {
    lastUpdated: fill(template.lastUpdated),
    sections: template.sections.map((section) => ({
      blocks: section.blocks
        .filter((block) => block.kind === "list" || recordingActive || !block.recordingOnly)
        .map((block): PrivacyNoticeBlock => {
          if (block.kind === "list") {
            return { items: resolveBullets(block.items), kind: "list" };
          }

          const clause = recordingActive ? (block.recordingClause ?? "") : "";
          return {
            kind: "paragraph",
            text: fill(`${block.text}${clause}${block.textEnd ?? ""}`),
          };
        }),
      heading: fill(section.heading),
      id: section.id,
    })),
    title: fill(template.title),
  };
}

const frenchPrivacyNotice: PrivacyNoticeTemplate = {
  lastUpdated: "Dernière mise à jour : {updatedDate}",
  sections: [
    {
      blocks: [
        {
          kind: "paragraph",
          text: "Cet entretien est mené pour {companyName}, responsable du traitement de vos données au sens du RGPD. HireCall fournit l'outil d'entretien et traite vos données pour le compte de {companyName}, sur ses instructions, sans les utiliser à d'autres fins.",
        },
      ],
      heading: "Qui est responsable de vos données",
      id: "controller",
    },
    {
      blocks: [
        {
          items: [
            { text: "Votre nom et, si vous la communiquez, votre adresse e-mail." },
            { text: "Vos réponses, sous forme de transcription écrite de l'entretien." },
            { recordingOnly: true, text: "L'enregistrement audio de votre voix." },
            {
              text: "Des informations techniques nécessaires au déroulement de l'entretien (horodatages, état de la connexion).",
            },
          ],
          kind: "list",
        },
        {
          kind: "paragraph",
          text: "Nous ne collectons ni image, ni vidéo, ni donnée biométrique. HireCall n'analyse ni votre visage, ni votre accent, ni votre ton, ni vos émotions, ni votre personnalité, ni aucune caractéristique protégée.",
        },
      ],
      heading: "Ce que nous traitons",
      id: "what-we-process",
    },
    {
      blocks: [
        {
          items: [
            {
              text: "Conduire l'entretien de présélection, en produire la transcription et le compte rendu remis au recruteur — base légale : mesures précontractuelles prises à votre demande (article 6(1)(b) du RGPD). Vous avez postulé ; cet entretien est une étape de l'examen de votre candidature.",
            },
            {
              recordingOnly: true,
              text: "Conserver un enregistrement audio pour que le recruteur puisse réécouter vos réponses — base légale : votre consentement (article 6(1)(a)). Vous pouvez le retirer à tout moment ; le retrait ne remet pas en cause ce qui a été fait avant.",
            },
          ],
          kind: "list",
        },
        {
          kind: "paragraph",
          text: "Aucune décision d'embauche ou de refus n'est prise automatiquement. Un recruteur humain décide de chaque suite donnée à votre candidature.",
        },
      ],
      heading: "Pourquoi, et sur quelle base",
      id: "legal-bases",
    },
    {
      blocks: [
        {
          items: [
            { text: "Les recruteurs de {companyName} habilités sur cet espace de travail." },
            { text: "HireCall, pour faire fonctionner le service." },
            {
              items: [
                { text: "LiveKit — transport audio en temps réel pendant l'entretien." },
                {
                  text: "OpenAI — traitement de la voix en temps réel pour conduire la conversation et produire la transcription. Vos données ne servent pas à entraîner les modèles du prestataire.",
                },
                {
                  recordingOnly: true,
                  text: "Cloudflare R2 — stockage de l'enregistrement audio.",
                },
              ],
              text: "Les prestataires techniques suivants, qui agissent pour le compte de HireCall :",
            },
          ],
          kind: "list",
        },
        {
          kind: "paragraph",
          text: "Certains de ces traitements peuvent avoir lieu en dehors de l'Union européenne. Dans ce cas, ils sont encadrés par les clauses contractuelles types de la Commission européenne.",
        },
        {
          kind: "paragraph",
          recordingOnly: true,
          text: "L'enregistrement audio est stocké dans l'Union européenne.",
        },
      ],
      heading: "Qui y a accès",
      id: "access",
    },
    {
      blocks: [
        {
          items: [
            {
              recordingOnly: true,
              text: "Enregistrement audio : 90 jours au maximum, puis suppression définitive.",
            },
            {
              text: "Transcription et compte rendu destiné au recruteur : 12 mois au maximum, puis suppression définitive.",
            },
            {
              text: "Après suppression, il subsiste uniquement une trace technique indiquant qu'un entretien a eu lieu et à quelle date, sans aucun contenu ni aucune appréciation.",
            },
          ],
          kind: "list",
        },
      ],
      heading: "Combien de temps",
      id: "retention",
    },
    {
      blocks: [
        {
          kind: "paragraph",
          recordingClause:
            ", ainsi que du droit de retirer votre consentement à l'enregistrement",
          text: "Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité",
          textEnd: ".",
        },
        {
          kind: "paragraph",
          text: "Pour les exercer, écrivez à privacy@hirecall.ai. HireCall traite votre demande pour le compte de {companyName} ; vous pouvez aussi vous adresser directement à {companyName}. Nous répondons sous un mois.",
        },
        {
          kind: "paragraph",
          text: "Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (www.cnil.fr) ou l'autorité de protection des données de votre pays de résidence.",
        },
      ],
      heading: "Vos droits",
      id: "rights",
    },
    {
      blocks: [
        {
          kind: "paragraph",
          text: "Vous pouvez arrêter l'entretien à tout moment avec le bouton « Quitter ». L'entretien s'arrête immédiatement et n'est pas marqué comme terminé. Pour faire supprimer ce qui a déjà été collecté, écrivez à privacy@hirecall.ai.",
        },
      ],
      heading: "Arrêter l'entretien",
      id: "stopping",
    },
  ],
  title: "Notice de confidentialité — entretien de présélection",
};

const englishPrivacyNotice: PrivacyNoticeTemplate = {
  lastUpdated: "Last updated: {updatedDate}",
  sections: [
    {
      blocks: [
        {
          kind: "paragraph",
          text: "This interview is run for {companyName}, the data controller under the GDPR. HireCall provides the interview tool and processes your data on behalf of {companyName}, on their instructions, and for no other purpose.",
        },
      ],
      heading: "Who is responsible for your data",
      id: "controller",
    },
    {
      blocks: [
        {
          items: [
            { text: "Your name and, if you provide it, your email address." },
            { text: "Your answers, as a written transcript of the interview." },
            { recordingOnly: true, text: "The audio recording of your voice." },
            {
              text: "Technical information needed to run the interview (timestamps, connection state).",
            },
          ],
          kind: "list",
        },
        {
          kind: "paragraph",
          text: "We collect no image, no video, and no biometric data. HireCall does not analyse your face, your accent, your tone, your emotions, your personality, or any protected attribute.",
        },
      ],
      heading: "What we process",
      id: "what-we-process",
    },
    {
      blocks: [
        {
          items: [
            {
              text: "To conduct the screening interview and produce the transcript and the brief given to the recruiter — legal basis: pre-contractual measures taken at your request (Article 6(1)(b) GDPR). You applied; this interview is a step in considering your application.",
            },
            {
              recordingOnly: true,
              text: "To keep an audio recording so the recruiter can listen back to your answers — legal basis: your consent (Article 6(1)(a)). You can withdraw it at any time; withdrawal does not affect what was done before.",
            },
          ],
          kind: "list",
        },
        {
          kind: "paragraph",
          text: "No hiring or rejection decision is made automatically. A human recruiter decides every next step on your application.",
        },
      ],
      heading: "Why, and on what basis",
      id: "legal-bases",
    },
    {
      blocks: [
        {
          items: [
            { text: "Recruiters at {companyName} authorised on this workspace." },
            { text: "HireCall, to operate the service." },
            {
              items: [
                { text: "LiveKit — real-time audio transport during the interview." },
                {
                  text: "OpenAI — real-time voice processing to conduct the conversation and produce the transcript. Your data is not used to train the provider's models.",
                },
                {
                  recordingOnly: true,
                  text: "Cloudflare R2 — storage of the audio recording.",
                },
              ],
              text: "The following technical providers, acting on HireCall's behalf:",
            },
          ],
          kind: "list",
        },
        {
          kind: "paragraph",
          text: "Some of this processing may take place outside the European Union. Where it does, it is covered by the European Commission's standard contractual clauses.",
        },
        {
          kind: "paragraph",
          recordingOnly: true,
          text: "The audio recording is stored in the European Union.",
        },
      ],
      heading: "Who has access",
      id: "access",
    },
    {
      blocks: [
        {
          items: [
            {
              recordingOnly: true,
              text: "Audio recording: up to 90 days, then permanently deleted.",
            },
            {
              text: "Transcript and the recruiter's brief: up to 12 months, then permanently deleted.",
            },
            {
              text: "After deletion, only a technical record remains showing that an interview took place and on what date, with no content and no assessment.",
            },
          ],
          kind: "list",
        },
      ],
      heading: "How long",
      id: "retention",
    },
    {
      blocks: [
        {
          kind: "paragraph",
          recordingClause:
            ", and the right to withdraw your consent to the recording",
          text: "You have the rights of access, rectification, erasure, restriction, objection and portability",
          textEnd: ".",
        },
        {
          kind: "paragraph",
          text: "To exercise them, write to privacy@hirecall.ai. HireCall handles your request on behalf of {companyName}; you may also contact {companyName} directly. We respond within one month.",
        },
        {
          kind: "paragraph",
          text: "If you believe your rights are not being respected, you can lodge a complaint with the CNIL (www.cnil.fr) or with the data protection authority of your country of residence.",
        },
      ],
      heading: "Your rights",
      id: "rights",
    },
    {
      blocks: [
        {
          kind: "paragraph",
          text: 'You can stop the interview at any time with the "Quit" button. The interview stops immediately and is not marked as complete. To have what was already collected deleted, write to privacy@hirecall.ai.',
        },
      ],
      heading: "Stopping the interview",
      id: "stopping",
    },
  ],
  title: "Privacy notice — screening interview",
};

const privacyNoticeByLanguage: Record<
  WorkspaceLanguage,
  PrivacyNoticeTemplate
> = {
  en: englishPrivacyNotice,
  fr: frenchPrivacyNotice,
};
