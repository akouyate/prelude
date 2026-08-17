import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  organization: { update: vi.fn() },
}));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const revalidateMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("../organizations/organization-scope", () => scopeMock);
vi.mock("next/cache", () => revalidateMock);
vi.mock("server-only", () => ({}));

import { updateWorkspaceSettingsAction } from "./workspace-settings-actions";

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
  scopeMock.getCompletedOrganizationScope.mockReset();
  scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope("owner"));
  revalidateMock.revalidatePath.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateWorkspaceSettingsAction — country", () => {
  it.each(CURATED_COUNTRIES)("accepts %s and writes it verbatim", async (country) => {
    await updateWorkspaceSettingsAction(formData({ country, name: "Acme" }));

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
        formData({ country: rawCountry, name: "Acme" }),
      );

      const call = prismaMock.organization.update.mock.calls[0]?.[0];
      expect(call.data).not.toHaveProperty("country");
    },
  );

  it("refuses a non-managing role and never touches the database", async () => {
    scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope("recruiter"));

    await expect(
      updateWorkspaceSettingsAction(formData({ country: "FR", name: "Acme" })),
    ).rejects.toThrow();
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it("round-trips: setting FR then unsetting writes FR, then an explicit null", async () => {
    await updateWorkspaceSettingsAction(formData({ country: "FR", name: "Acme" }));
    expect(prismaMock.organization.update).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ country: "FR" }),
      where: { id: "org_123" },
    });

    await updateWorkspaceSettingsAction(formData({ country: "", name: "Acme" }));
    expect(prismaMock.organization.update).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ country: null }),
      where: { id: "org_123" },
    });
  });

  it("a prior FR survives an invalid resubmission — schema failure is never a silent clear", async () => {
    await updateWorkspaceSettingsAction(formData({ country: "FR", name: "Acme" }));
    expect(prismaMock.organization.update).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ country: "FR" }),
      where: { id: "org_123" },
    });

    await updateWorkspaceSettingsAction(formData({ country: "DE", name: "Acme" }));
    const secondCall = prismaMock.organization.update.mock.calls[1]?.[0];
    expect(secondCall.data).not.toHaveProperty("country");
  });
});
