import {
  candidateConsentCopyV3,
  candidateConsentCopyV3Fr,
  candidateConsentCopyV3NoRecording,
  candidateConsentCopyV3NoRecordingFr,
  candidateDisclosureCopyV3,
  candidateDisclosureCopyV3Fr,
  candidateDisclosureCopyV3NoRecording,
  candidateDisclosureCopyV3NoRecordingFr,
} from "@prelude/core";
import { describe, expect, it } from "vitest";

import { candidateTrustCopyFor } from "./candidate-trust-copy";

describe("candidateTrustCopyFor", () => {
  // The panel claims to show "exactly what every candidate is told and agrees
  // to". These two rows are the ones a recruiter actually meets today: a French
  // screen on a deployment with recording off, and an English one with it on.
  it("shows the French no-recording pair for a French draft while recording is off", () => {
    const copy = candidateTrustCopyFor("fr", false);

    expect(copy.disclosure.text).toBe(candidateDisclosureCopyV3NoRecordingFr);
    expect(copy.consent.text).toBe(candidateConsentCopyV3NoRecordingFr);
    expect(copy.disclosure.version).toBe(
      "candidate-disclosure-v3-no-recording",
    );
    expect(copy.consent.version).toBe("candidate-consent-v3-no-recording");

    // Not the English variant wearing a French version id, and not a variant
    // that promises a recording this deployment never makes.
    expect(copy.disclosure.text).not.toBe(candidateDisclosureCopyV3NoRecording);
    expect(copy.consent.text).not.toBe(candidateConsentCopyV3Fr);
  });

  it("shows the English recording pair for an English draft while recording is on", () => {
    const copy = candidateTrustCopyFor("en", true);

    expect(copy.disclosure.text).toBe(candidateDisclosureCopyV3);
    expect(copy.consent.text).toBe(candidateConsentCopyV3);
    expect(copy.disclosure.version).toBe("candidate-disclosure-v3");
    expect(copy.consent.version).toBe("candidate-consent-v3");

    expect(copy.disclosure.text).not.toBe(candidateDisclosureCopyV3Fr);
    expect(copy.consent.text).not.toBe(candidateConsentCopyV3NoRecording);
  });

  it("follows the interview language, not the recording flag, on the other two corners", () => {
    expect(candidateTrustCopyFor("en", false).consent.text).toBe(
      candidateConsentCopyV3NoRecording,
    );
    expect(candidateTrustCopyFor("fr", true).consent.text).toBe(
      candidateConsentCopyV3Fr,
    );
  });

  it("never shows the frozen v2 copy the panel used to print", () => {
    // The regression this module exists to prevent: v2 is English-only and
    // predates the recording variants, so it was wrong on both axes.
    const versions = (["en", "fr"] as const).flatMap((language) =>
      [true, false].flatMap((recordingActive) => {
        const copy = candidateTrustCopyFor(language, recordingActive);
        return [copy.disclosure.version, copy.consent.version];
      }),
    );

    expect(versions.some((version) => version.includes("-v2"))).toBe(false);
  });
});
