import { describe, expect, it, vi } from "vitest";
import {
  normalizeBillingSubscription,
  unconfiguredBilling,
} from "@prelude/billing";

vi.mock("server-only", () => ({}));

import {
  canManageWorkspaceBilling,
  parseOrganizationSettings,
  toWorkspaceSettingsBilling,
} from "./workspace-settings-data";

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
      candidateCompletionConfirmation: true,
      mentionsAndComments: true,
      productUpdates: false,
      screensReadyForReview: true,
      weeklyDigest: false,
    });
  });

  it("reads persisted preferences defensively and migrates the legacy completion key", () => {
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
      candidateCompletionConfirmation: false,
      mentionsAndComments: false,
      productUpdates: true,
      screensReadyForReview: false,
      weeklyDigest: true,
    });
  });
});

describe("toWorkspaceSettingsBilling", () => {
  it("maps the paid projection and usage for Settings", () => {
    const billing = normalizeBillingSubscription(
      {
        id: "sub_1",
        items: [
          {
            id: "item_1",
            isDefault: false,
            isFreeTrial: false,
            periodEnd: new Date("2026-08-01T00:00:00.000Z"),
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            planId: "plan_1",
            planName: "V1 Workspace",
            planSlug: "v1-workspace",
            status: "active",
            updatedAt: new Date("2026-07-24T10:00:00.000Z"),
          },
        ],
        status: "active",
        updatedAt: new Date("2026-07-24T10:00:00.000Z"),
      },
      {
        now: new Date("2026-07-24T12:00:00.000Z"),
        paidPlanSlug: "v1-workspace",
      },
    );

    expect(
      toWorkspaceSettingsBilling({
        authProvider: "clerk",
        billing,
        canManageBilling: true,
        usage: { candidateInterviews: 7, publishedRoles: 2 },
      }),
    ).toEqual({
      canManageBilling: true,
      manageBillingUnavailableReason: null,
      entitlements: { recording: true },
      limits: { candidateInterviews: 250, publishedRoles: 25 },
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodStart: "2026-07-01T00:00:00.000Z",
      planName: "V1 Workspace",
      state: "active",
      usage: { candidateInterviews: 7, publishedRoles: 2 },
    });
  });

  it("represents local unconfigured billing as unmetered without portal access", () => {
    expect(
      toWorkspaceSettingsBilling({
        authProvider: "clerk",
        billing: unconfiguredBilling(new Date("2026-07-24T12:00:00.000Z")),
        canManageBilling: true,
        usage: { candidateInterviews: 99, publishedRoles: 10 },
      }),
    ).toMatchObject({
      canManageBilling: false,
      manageBillingUnavailableReason: "not_configured",
      limits: { candidateInterviews: null, publishedRoles: null },
      state: "unconfigured",
    });
  });

  it("explains that payment actions are unavailable in local mock mode", () => {
    const billing = normalizeBillingSubscription(
      {
        id: "sub_1",
        items: [
          {
            id: "item_1",
            isDefault: false,
            isFreeTrial: false,
            periodEnd: new Date("2026-08-01T00:00:00.000Z"),
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            planId: "plan_1",
            planName: "V1 Workspace",
            planSlug: "v1-workspace",
            status: "active",
            updatedAt: new Date("2026-07-24T10:00:00.000Z"),
          },
        ],
        status: "active",
        updatedAt: new Date("2026-07-24T10:00:00.000Z"),
      },
      {
        now: new Date("2026-07-24T12:00:00.000Z"),
        paidPlanSlug: "v1-workspace",
      },
    );

    expect(
      toWorkspaceSettingsBilling({
        authProvider: "mock",
        billing,
        canManageBilling: false,
        usage: { candidateInterviews: 1, publishedRoles: 1 },
      }),
    ).toMatchObject({
      canManageBilling: false,
      manageBillingUnavailableReason: "local_mock",
    });
  });
});

describe("canManageWorkspaceBilling", () => {
  it("allows only a real Clerk workspace owner to open the billing portal", () => {
    expect(
      canManageWorkspaceBilling({ authProvider: "clerk", role: "owner" }),
    ).toBe(true);

    for (const role of ["admin", "recruiter", "viewer"]) {
      expect(canManageWorkspaceBilling({ authProvider: "clerk", role })).toBe(
        false,
      );
    }

    expect(
      canManageWorkspaceBilling({ authProvider: "mock", role: "owner" }),
    ).toBe(false);
  });
});
