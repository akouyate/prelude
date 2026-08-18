import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
}));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const revalidateMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("../organizations/organization-scope", () => scopeMock);
vi.mock("next/cache", () => revalidateMock);
vi.mock("server-only", () => ({}));
// Same test-double convention as interview-actions.test.ts: the server-side
// locale resolution is not what this suite is about, so it is pinned to a
// deterministic identity translator instead of loading the real catalogs.
vi.mock("../users/user-locale", () => ({
  getAuthenticatedUserLocale: vi.fn(async () => "en"),
}));
vi.mock("../../libs/i18n-server", () => ({
  coerceConsoleLocale: (value: string | undefined | null) =>
    value === "fr" ? "fr" : "en",
  getServerT: () => (key: string) => key,
}));

import {
  updateInterviewPreferencesAction,
  updateNotificationPreferencesAction,
  updateWorkspaceSettingsAction,
  type SettingsActionState,
} from "./workspace-settings-actions";

const IDLE_STATE: SettingsActionState = { error: null, ok: false };

function scope(role: string) {
  return {
    organizationId: "org_123",
    organizationName: "Acme Talent",
    clerkOrganizationId: null,
    role,
    userId: "user_123",
  };
}

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

const CURATED_COUNTRIES = [
  "FR",
  "BE",
  "CH",
  "LU",
  "GB",
  "US",
  "CA",
  "OTHER_EU",
  "OTHER_NON_EU",
];

beforeEach(() => {
  prismaMock.organization.update.mockReset();
  prismaMock.organization.update.mockResolvedValue({});
  prismaMock.organization.findUniqueOrThrow.mockReset();
  prismaMock.organization.findUniqueOrThrow.mockResolvedValue({
    settings: {},
  });
  scopeMock.getCompletedOrganizationScope.mockReset();
  scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope("owner"));
  revalidateMock.revalidatePath.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateWorkspaceSettingsAction — country", () => {
  it.each(CURATED_COUNTRIES)("accepts %s and writes it verbatim", async (country) => {
    await updateWorkspaceSettingsAction(
      IDLE_STATE,
      formData({ country, name: "Acme" }),
    );

    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ country }),
      where: { id: "org_123" },
    });
  });

  // The undefined-filter footgun, used deliberately in the SAFE direction here:
  // the blank "Not set" sentinel (absent field or explicit "") is the only
  // input that means "clear it" and must always resolve to an explicit `null`,
  // never an omitted key.
  it.each([
    ["an absent", {}],
    ["a blank", { country: "" }],
  ])(
    "writes an explicit null for %s country — the deliberate 'Not set' sentinel",
    async (_label, extraFields) => {
      await updateWorkspaceSettingsAction(
        IDLE_STATE,
        formData({ name: "Acme", ...extraFields }),
      );

      const call = prismaMock.organization.update.mock.calls[0]?.[0];
      expect(call.data).toHaveProperty("country", null);
    },
  );

  // "reject ≠ clear": a non-blank value that fails organizationCountrySchema
  // (a stale/tampered/non-browser submission — the select never produces one)
  // must never silently overwrite a previously declared country with null.
  // The key is left off the update entirely, so Prisma's undefined-drop does
  // "leave unchanged" on purpose, instead of "leave unchanged" by accident.
  it.each(["DE", "fr"])(
    "leaves country out of the update entirely for invalid input %j",
    async (rawCountry) => {
      await updateWorkspaceSettingsAction(
        IDLE_STATE,
        formData({ country: rawCountry, name: "Acme" }),
      );

      const call = prismaMock.organization.update.mock.calls[0]?.[0];
      expect(call.data).not.toHaveProperty("country");
    },
  );

  // Re-derived from T3: this used to assert `rejects.toThrow()` (an unhandled
  // exception — QA T8 finding B.6/Finding 2). A non-manager submit must now
  // resolve to the section's standard `{ error, ok }` action-state shape
  // instead of throwing, so the form can render an inline message rather than
  // crash. "viewer" matches the QA repro's MOCK_CLERK_ORG_ROLE=viewer exactly.
  it("refuses a non-managing role with the standard error shape, and never touches the database", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope("viewer"));

    const result = await updateWorkspaceSettingsAction(
      IDLE_STATE,
      formData({ country: "FR", name: "Acme" }),
    );

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toHaveLength(0);
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it("round-trips: setting FR then unsetting writes FR, then an explicit null", async () => {
    await updateWorkspaceSettingsAction(
      IDLE_STATE,
      formData({ country: "FR", name: "Acme" }),
    );
    expect(prismaMock.organization.update).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ country: "FR" }),
      where: { id: "org_123" },
    });

    await updateWorkspaceSettingsAction(
      IDLE_STATE,
      formData({ country: "", name: "Acme" }),
    );
    expect(prismaMock.organization.update).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ country: null }),
      where: { id: "org_123" },
    });
  });

  it("a prior FR survives an invalid resubmission — schema failure is never a silent clear", async () => {
    await updateWorkspaceSettingsAction(
      IDLE_STATE,
      formData({ country: "FR", name: "Acme" }),
    );
    expect(prismaMock.organization.update).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ country: "FR" }),
      where: { id: "org_123" },
    });

    await updateWorkspaceSettingsAction(
      IDLE_STATE,
      formData({ country: "DE", name: "Acme" }),
    );
    const secondCall = prismaMock.organization.update.mock.calls[1]?.[0];
    expect(secondCall.data).not.toHaveProperty("country");
  });
});

// Plan 2026-08-18, Part 2, site 4: these two actions used to just propagate
// assertCanEditSettings's throw as an unhandled exception (same QA T8 finding
// B.6 the workspace action was already fixed for). They now answer with the
// section's standard `{ error, ok }` shape instead, so the client can toast
// the refusal instead of crashing.
describe("updateInterviewPreferencesAction", () => {
  it("refuses a non-managing role with the standard error shape, and never touches the database", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope("viewer"));

    const result = await updateInterviewPreferencesAction(
      IDLE_STATE,
      formData({}),
    );

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toHaveLength(0);
    expect(prismaMock.organization.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it("saves and reports ok for a managing role", async () => {
    const result = await updateInterviewPreferencesAction(
      IDLE_STATE,
      formData({ allowAudio: "true", interviewerVoice: "maya" }),
    );

    expect(result).toEqual({ error: null, ok: true });
    expect(prismaMock.organization.update).toHaveBeenCalledTimes(1);
  });
});

describe("updateNotificationPreferencesAction", () => {
  it("refuses a non-managing role with the standard error shape, and never touches the database", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope("recruiter"));

    const result = await updateNotificationPreferencesAction(
      IDLE_STATE,
      formData({}),
    );

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toHaveLength(0);
    expect(prismaMock.organization.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it("saves and reports ok for a managing role", async () => {
    const result = await updateNotificationPreferencesAction(
      IDLE_STATE,
      formData({ weeklyDigest: "true" }),
    );

    expect(result).toEqual({ error: null, ok: true });
    expect(prismaMock.organization.update).toHaveBeenCalledTimes(1);
  });
});
