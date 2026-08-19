import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CandidateInterviewIntro,
  CandidatePreflightExperience,
  CandidateWelcomeExperience,
  formatCandidateModes,
  type CandidateInterviewExperienceLabels,
} from "./candidate-interview-experience";

// French labels on purpose: the whole point of the labels contract is that the
// package holds no English of its own, so a French render must contain no
// leftover English chrome.
const labels: CandidateInterviewExperienceLabels = {
  answersBody: "Seul le contenu de vos réponses parvient au recruteur.",
  answersTitle: "Vos réponses, pas votre apparence",
  audioOnlyNotice:
    "Cet entretien se déroule à la voix. Vous n'avez besoin que de votre microphone.",
  durationPill: "Environ 6 minutes",
  emailLabel: "E-mail",
  emailOptional: "facultatif",
  emailPlaceholder: "vous@exemple.com",
  evidenceBody:
    "Vos propos sont conservés comme éléments de transcription pour la revue du recruteur.",
  evidenceTitle: "Transcrit pour la revue",
  fairnessHeading: "Équitable, posé et transparent.",
  fairnessKicker: "Comment se déroule cet entretien",
  formatLabel: "Format",
  formatValue: "audio",
  humanReviewedPill: "Revu par un humain",
  introDescription: "Product Designer chez Acme.",
  introHeading: "Préparons votre entretien",
  introPill: "Premier échange confidentiel",
  invitation: "Acme vous invite à un premier échange",
  lengthLabel: "Durée",
  lengthValue: "Environ 6 min",
  listeningNoteEmphasis: "ce que vous dites",
  listeningNoteLead: "Nous écoutons",
  modesPill: "audio, réponses écrites",
  nameLabel: "Votre nom",
  namePlaceholder: "Votre nom",
  paceBody: "Aucun chronomètre sur les réponses. Prenez le temps de réfléchir.",
  paceTitle: "Avancez à votre rythme",
  preflightHeading: "Avant de commencer",
  preflightSubtitle: "Product Designer · environ 6 minutes",
  privacyPill: "Entretien confidentiel",
  roleLabel: "Poste",
  startButton: "Commencer",
  startFootnote: "Aucun compte requis · Prenez votre temps à chaque réponse",
};

describe("candidate interview experience", () => {
  it("renders the welcome screen from the labels it is given", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <CandidateWelcomeExperience
        disclosureCopy="Vous parlez avec un intervieweur guidé par l'IA."
        labels={labels}
        onStart={onStart}
        roleTitle="Product Designer"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Product Designer" }),
    ).toBeVisible();
    expect(screen.getByText("audio, réponses écrites")).toBeVisible();
    expect(screen.getByText("Environ 6 minutes")).toBeVisible();
    expect(screen.getByText("Revu par un humain")).toBeVisible();
    expect(screen.getByText("Entretien confidentiel")).toBeVisible();
    expect(screen.getByText("Vos réponses, pas votre apparence")).toBeVisible();
    expect(screen.getByText("Avancez à votre rythme")).toBeVisible();
    expect(screen.getByText("Transcrit pour la revue")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Commencer/u }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("keeps the listening note out of the statutory disclosure string", () => {
    // Legal ruling R5.1: the trailing "we listen to what you say" fragment sits
    // inside the disclosure paragraph, so it has to be translated with it —
    // while the reviewed disclosure text itself stays byte-exact.
    const disclosureCopy = "Vous parlez avec un intervieweur guidé par l'IA.";

    // Scoped to this render's container: the file has no auto-cleanup, so the
    // earlier welcome render is still in the document.
    const { container } = render(
      <CandidateWelcomeExperience
        disclosureCopy={disclosureCopy}
        labels={labels}
        onStart={vi.fn()}
        roleTitle="Product Designer"
      />,
    );

    const paragraph = within(container).getByText(/Nous écoutons/u);

    expect(paragraph.textContent).toBe(
      `${disclosureCopy} Nous écoutons ce que vous dites.`,
    );
  });

  it("renders the setup intro facts from the labels it is given", () => {
    render(
      <CandidateInterviewIntro jobTitle="Product Designer" labels={labels} />,
    );

    expect(screen.getByText("Préparons votre entretien")).toBeVisible();
    expect(screen.getByText("Product Designer chez Acme.")).toBeVisible();
    expect(screen.getByText("Poste")).toBeVisible();
    expect(screen.getByText("Format")).toBeVisible();
    expect(screen.getByText("Durée")).toBeVisible();
    expect(screen.getByText("Environ 6 min")).toBeVisible();
  });

  it("keeps preflight values controlled by the host experience", async () => {
    const user = userEvent.setup();
    const onCandidateNameChange = vi.fn();
    const onConsentChange = vi.fn();

    render(
      <CandidatePreflightExperience
        candidateEmail=""
        candidateName=""
        consentAccepted={false}
        consentCopy="Je comprends que je participe à un entretien guidé par l'IA."
        labels={labels}
        onCandidateEmailChange={vi.fn()}
        onCandidateNameChange={onCandidateNameChange}
        onConsentChange={onConsentChange}
      />,
    );

    expect(screen.getByText("Avant de commencer")).toBeVisible();
    expect(
      screen.getByText("Product Designer · environ 6 minutes"),
    ).toBeVisible();
    expect(screen.getByText(labels.audioOnlyNotice)).toBeVisible();

    await user.type(screen.getByPlaceholderText("Votre nom"), "Ada");
    await user.click(screen.getByRole("checkbox"));

    expect(onCandidateNameChange).toHaveBeenCalled();
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("normalizes builder text mode to the caller's mode labels", () => {
    const modeLabels = { audio: "audio", formFallback: "réponses écrites" };

    expect(formatCandidateModes(["text", "audio"], modeLabels)).toBe(
      "réponses écrites, audio",
    );
    expect(formatCandidateModes([], modeLabels)).toBe("audio");
  });
});
