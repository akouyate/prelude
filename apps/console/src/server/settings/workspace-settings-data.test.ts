import { describe, expect, it, vi } from "vitest";
import {
  normalizeBillingSubscription,
  unconfiguredBilling,
} from "@prelude/billing";

vi.mock("server-only", () => ({}));

import {
  canManageWorkspaceBilling,
  parseOrganizationSettings,
  toWorkspaceCreditBilling,
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

/**
 * Amendment 15 — the balance is never a bare number. "You have 12 credits" hides
 * the two facts a recruiter needs before deciding to buy: how many they PAID for
 * (the free five are not a renewable allowance) and what is about to expire.
 */
describe("toWorkspaceCreditBilling", () => {
  const now = new Date("2026-08-15T09:00:00.000Z");

  function lot(overrides: Record<string, unknown> = {}) {
    return {
      id: "lot_1",
      kind: "paid",
      status: "active",
      creditsGranted: 100,
      creditsConsumed: 0,
      creditsReserved: 0,
      grantedAt: new Date("2026-08-01T09:00:00.000Z"),
      expiresAt: new Date("2027-08-01T09:00:00.000Z"),
      ...overrides,
    };
  }

  function pack(overrides: Record<string, unknown> = {}) {
    return {
      id: "hiring_100",
      creditsGranted: 100,
      unitAmountCents: 34900,
      unitAmountCentsUsd: 37900,
      visibility: "public",
      enabled: true,
      displayOrder: 2,
      ...overrides,
    };
  }

  it("tells the UI whether this viewer may buy, so the buttons are not decorative", () => {
    // Same owner/admin set as the action and the return route. The server refuses
    // regardless; this flag is what stops the console offering a button that can
    // only answer "not allowed".
    for (const role of ["owner", "admin"] as const) {
      expect(
        toWorkspaceCreditBilling({ lots: [], packs: [pack()], now, role }).canPurchase,
      ).toBe(true);
    }
    for (const role of ["recruiter", "viewer"] as const) {
      expect(
        toWorkspaceCreditBilling({ lots: [], packs: [pack()], now, role }).canPurchase,
      ).toBe(false);
    }
  });

  it("still shows a non-manager the balance and the catalogue — they just cannot buy", () => {
    // Hiding the wallet from a recruiter would be worse than useless: they need to
    // know whether an interview can even run before they invite a candidate.
    const result = toWorkspaceCreditBilling({
      lots: [lot({ creditsGranted: 40 })],
      packs: [pack()],
      now,
      role: "viewer",
    });

    expect(result.paidAvailable).toBe(40);
    expect(result.packs).toHaveLength(1);
  });

  it("splits what was paid for from what was offered, and names the soonest expiry", () => {
    const result = toWorkspaceCreditBilling({
      lots: [
        lot({ id: "lot_paid", creditsGranted: 100, creditsConsumed: 12, creditsReserved: 1 }),
        lot({
          id: "lot_free",
          kind: "free",
          creditsGranted: 5,
          creditsConsumed: 2,
          expiresAt: new Date("2026-09-01T09:00:00.000Z"),
        }),
      ],
      packs: [pack()],
      now,
      role: "owner",
    });

    expect(result.paidAvailable).toBe(87);
    expect(result.freeAvailable).toBe(3);
    // The free lot dies first — that is the one worth warning about.
    expect(result.nextExpiry).toEqual({
      credits: 3,
      expiresAt: "2026-09-01T09:00:00.000Z",
    });
  });

  it("ignores expired and revoked lots in the balance", () => {
    const result = toWorkspaceCreditBilling({
      lots: [
        lot({ id: "lot_gone", expiresAt: new Date("2026-08-01T09:00:00.000Z") }),
        lot({ id: "lot_revoked", status: "revoked" }),
        lot({ id: "lot_live", creditsGranted: 25 }),
      ],
      packs: [pack()],
      now,
      role: "owner",
    });

    expect(result.paidAvailable).toBe(25);
  });

  it("reads an empty wallet as zero rather than as nothing to render", () => {
    const result = toWorkspaceCreditBilling({ lots: [], packs: [pack()], now, role: "owner" });

    expect(result).toMatchObject({ paidAvailable: 0, freeAvailable: 0, nextExpiry: null });
  });

  it("lists only enabled public packs, in display order", () => {
    const result = toWorkspaceCreditBilling({
      lots: [],
      now,
      role: "owner",
      packs: [
        pack({ id: "scale_500", creditsGranted: 500, unitAmountCents: 149000, displayOrder: 3 }),
        pack({ id: "starter_25", creditsGranted: 25, unitAmountCents: 9900, displayOrder: 1 }),
        pack(),
        pack({ id: "legacy_50", enabled: false, displayOrder: 0 }),
      ],
    });

    expect(result.packs.map((entry) => entry.id)).toEqual([
      "starter_25",
      "hiring_100",
      "scale_500",
    ]);
    expect(result.packs[0]).toEqual({
      id: "starter_25",
      creditsGranted: 25,
      unitAmountCents: 9900,
      unitAmountCentsUsd: 37900,
    });
  });

  /**
   * Amendment 20 — `visibility: "quiet"` gates LISTING, not purchase. The volume
   * line under the three public packs opens a real checkout, so the loader hands
   * the UI the id instead of letting a component hardcode a catalogue slug.
   */
  it("keeps the quiet pack out of the list but hands its id to the volume gate", () => {
    const result = toWorkspaceCreditBilling({
      lots: [],
      now,
      role: "owner",
      packs: [
        pack(),
        pack({ id: "volume_1000", visibility: "quiet", creditsGranted: 1000, displayOrder: 4 }),
      ],
    });

    expect(result.packs.map((entry) => entry.id)).toEqual(["hiring_100"]);
    expect(result.volumePackId).toBe("volume_1000");
  });

  it("offers no volume gate when the catalogue has no quiet pack to sell", () => {
    const result = toWorkspaceCreditBilling({
      lots: [],
      now,
      role: "owner",
      packs: [pack(), pack({ id: "volume_1000", visibility: "quiet", enabled: false })],
    });

    expect(result.volumePackId).toBeNull();
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
