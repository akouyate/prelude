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

  // The undefined-filter footgun: `country: undefined` in a Prisma update data
  // object is silently dropped rather than clearing the column. "Not set" must
  // always resolve to an explicit `null`, never an omitted key.
  it("accepts an absent country and writes an explicit null, not a skipped key", async () => {
    await updateWorkspaceSettingsAction(formData({ name: "Acme" }));

    const call = prismaMock.organization.update.mock.calls[0]?.[0];
    expect(call.data).toHaveProperty("country", null);
  });

  it.each(["DE", "fr", ""])(
    "rejects %j — falls back to an explicit null rather than persisting it",
    async (rawCountry) => {
      await updateWorkspaceSettingsAction(
        formData({ country: rawCountry, name: "Acme" }),
      );

      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        data: expect.objectContaining({ country: null }),
        where: { id: "org_123" },
      });
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
});
