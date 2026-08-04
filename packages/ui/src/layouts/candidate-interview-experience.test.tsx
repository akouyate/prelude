import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CandidatePreflightExperience,
  CandidateWelcomeExperience,
  formatCandidateModes,
} from "./candidate-interview-experience";

describe("candidate interview experience", () => {
  it("renders the real welcome content and advances on request", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <CandidateWelcomeExperience
        companyName="Acme"
        disclosureCopy="You are speaking with an AI-guided interviewer."
        estimatedMinutes={6}
        jobTitle="Product Designer"
        onStart={onStart}
        responseModes={["audio", "text"]}
        roleTitle="Product Designer"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Product Designer" }),
    ).toBeVisible();
    expect(screen.getByText("audio, form fallback")).toBeVisible();
    expect(screen.getByText("About 6 minutes")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Get started/u }));

    expect(onStart).toHaveBeenCalledTimes(1);
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
        consentCopy="I consent to the interview recording."
        estimatedMinutes={5}
        jobTitle="Customer Success Manager"
        onCandidateEmailChange={vi.fn()}
        onCandidateNameChange={onCandidateNameChange}
        onConsentChange={onConsentChange}
      />,
    );

    await user.type(screen.getByPlaceholderText("Your name"), "Ada");
    await user.click(screen.getByRole("checkbox"));

    expect(onCandidateNameChange).toHaveBeenCalled();
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("normalizes builder text mode to the candidate form label", () => {
    expect(formatCandidateModes(["text", "audio"])).toBe(
      "form fallback, audio",
    );
  });
});
