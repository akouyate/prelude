import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseOrganizationSettings } from "./workspace-settings-data";

describe("parseOrganizationSettings", () => {
  it("returns V1 defaults when organization settings are empty", () => {
    const settings = parseOrganizationSettings({});

    expect(settings.interview).toEqual({
      allowAudio: true,
      allowForm: true,
      autoGenerateTranscript: true,
      defaultLanguage: "en",
      interviewerVoice: "maya",
      requireRecordingConsent: true,
      showReviewGuardrail: true,
    });
    expect(settings.notifications).toEqual({
      interviewCompleted: true,
      mentionsAndComments: true,
      productUpdates: false,
      screensReadyForReview: true,
      weeklyDigest: false,
    });
  });

  it("reads persisted interview and notification preferences defensively", () => {
    const settings = parseOrganizationSettings({
      interview: {
        allowAudio: false,
        allowForm: true,
        autoGenerateTranscript: false,
        defaultLanguage: "fr",
        interviewerVoice: "lea",
        requireRecordingConsent: false,
        showReviewGuardrail: false,
      },
      notifications: {
        interviewCompleted: false,
        mentionsAndComments: false,
        productUpdates: true,
        screensReadyForReview: false,
        weeklyDigest: true,
      },
    });

    expect(settings.interview).toMatchObject({
      allowAudio: false,
      allowForm: true,
      autoGenerateTranscript: false,
      defaultLanguage: "fr",
      interviewerVoice: "lea",
      requireRecordingConsent: false,
      showReviewGuardrail: false,
    });
    expect(settings.notifications).toMatchObject({
      interviewCompleted: false,
      mentionsAndComments: false,
      productUpdates: true,
      screensReadyForReview: false,
      weeklyDigest: true,
    });
  });
});
