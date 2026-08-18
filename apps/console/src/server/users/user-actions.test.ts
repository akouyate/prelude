import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
}));

const scopeMock = vi.hoisted(() => ({
  getCompletedOrganizationScope: vi.fn(),
}));

const authSessionMock = vi.hoisted(() => ({
  getConsoleAuthSession: vi.fn(),
}));

const revalidateMock = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

const updateUserMock = vi.hoisted(() => vi.fn());
const clerkClientMock = vi.hoisted(() =>
  vi.fn(async () => ({ users: { updateUser: updateUserMock } })),
);

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("../organizations/organization-scope", () => scopeMock);
vi.mock("../auth/console-auth-provider", () => authSessionMock);
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: clerkClientMock }));
vi.mock("next/cache", () => revalidateMock);
vi.mock("server-only", () => ({}));
vi.mock("./user-locale", () => ({
  getAuthenticatedUserLocale: vi.fn(async () => "en"),
}));
vi.mock("../../libs/i18n-server", () => ({
  coerceConsoleLocale: (value: string | undefined | null) =>
    value === "fr" ? "fr" : "en",
  getServerT: () => (key: string) => key,
}));

import {
  updateProfileNameAction,
  updatePreferredLanguage,
  type UpdateProfileNameActionState,
} from "./user-actions";

const IDLE_STATE: UpdateProfileNameActionState = { error: null, ok: false };

function scope() {
  return {
    organizationId: "org_123",
    organizationName: "Acme Talent",
    clerkOrganizationId: "org_clerk_123",
    role: "owner",
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

function clerkSession() {
  return { ok: true, value: { source: "clerk", userId: "clerk_user_123" } };
}

function mockSession() {
  return { ok: true, value: { source: "mock", userId: "user_demo" } };
}

beforeEach(() => {
  prismaMock.user.findUniqueOrThrow.mockReset();
  prismaMock.user.findUniqueOrThrow.mockResolvedValue({
    clerkUserId: "clerk_user_123",
  });
  prismaMock.user.update.mockReset();
  prismaMock.user.update.mockResolvedValue({});
  scopeMock.getCompletedOrganizationScope.mockReset();
  scopeMock.getCompletedOrganizationScope.mockResolvedValue(scope());
  authSessionMock.getConsoleAuthSession.mockReset();
  authSessionMock.getConsoleAuthSession.mockResolvedValue(clerkSession());
  revalidateMock.revalidatePath.mockReset();
  updateUserMock.mockReset();
  updateUserMock.mockResolvedValue({});
  clerkClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateProfileNameAction", () => {
  it("writes to Clerk and mirrors the name to the DB on success", async () => {
    const result = await updateProfileNameAction(
      IDLE_STATE,
      formData({ name: "Ada Lovelace" }),
    );

    expect(updateUserMock).toHaveBeenCalledWith("clerk_user_123", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { name: "Ada Lovelace" },
      where: { id: "user_123" },
    });
    expect(result).toEqual({ error: null, ok: true });
  });

  // The honest-failure rule: the two writes must never silently diverge.
  it("does NOT write the DB mirror when the Clerk write fails", async () => {
    updateUserMock.mockRejectedValue(new Error("Clerk is down"));

    const result = await updateProfileNameAction(
      IDLE_STATE,
      formData({ name: "Ada Lovelace" }),
    );

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).not.toHaveLength(0);
  });

  it("under the mock auth provider, writes the DB mirror only — never calls Clerk", async () => {
    authSessionMock.getConsoleAuthSession.mockResolvedValue(mockSession());

    const result = await updateProfileNameAction(
      IDLE_STATE,
      formData({ name: "Demo Recruiter" }),
    );

    expect(clerkClientMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      data: { name: "Demo Recruiter" },
      where: { id: "user_123" },
    });
    expect(result).toEqual({ error: null, ok: true });
  });

  it("a single-word name leaves lastName undefined rather than blank", async () => {
    await updateProfileNameAction(IDLE_STATE, formData({ name: "Madonna" }));

    expect(updateUserMock).toHaveBeenCalledWith("clerk_user_123", {
      firstName: "Madonna",
      lastName: undefined,
    });
  });

  it("trims and rejects a blank name without touching Clerk or the DB", async () => {
    const result = await updateProfileNameAction(
      IDLE_STATE,
      formData({ name: "   " }),
    );

    expect(clerkClientMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null, ok: false });
  });
});

describe("updatePreferredLanguage", () => {
  it("returns a localized error and does not throw when the write fails", async () => {
    scopeMock.getCompletedOrganizationScope.mockRejectedValue(
      new Error("no scope"),
    );

    const result = await updatePreferredLanguage("fr");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
      expect(result.error).not.toHaveLength(0);
    }
  });
});
