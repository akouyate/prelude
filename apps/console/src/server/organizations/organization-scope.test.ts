import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for a bug this plan uncovered (plan 2026-08-18, Part 1):
// `ensureDevelopmentUser` used to unconditionally re-sync `email`/`name` from
// the MOCK_CLERK_USER_* env vars on every request that resolves scope under
// the mock auth provider — silently reverting a user's edited display name
// back to the mock default on the very next page load, which made the new
// editable-name feature a no-op in the only environment this repo can
// exercise it in without real Clerk credentials (`make dev`, Playwright's
// default). This suite pins the fix: once a mock user row exists for a given
// clerkUserId, resolving scope again must not touch it.

const prismaMock = vi.hoisted(() => ({
  organization: { upsert: vi.fn() },
  organizationMembership: { upsert: vi.fn() },
  user: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // React's `cache()` is a request-scoped memoizer meant for the App
  // Router's per-render cache; outside that context (this test, or a repeat
  // call within the same test) it must not silently dedupe across two
  // deliberately separate calls, or this regression would be invisible.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import { getCompletedOrganizationScope } from "./organization-scope";

beforeEach(() => {
  process.env.CONSOLE_AUTH_PROVIDER = "mock";
  process.env.MOCK_CLERK_USER_ID = "user_demo";
  process.env.MOCK_CLERK_USER_EMAIL = "recruiter@hirecall.ai";
  process.env.MOCK_CLERK_USER_NAME = "Adrien Kouyate";
  process.env.MOCK_CLERK_ORG_ID = "org_demo";

  prismaMock.organization.upsert.mockReset();
  prismaMock.organization.upsert.mockResolvedValue({
    id: "org_1",
    name: "Acme Talent",
  });
  prismaMock.organizationMembership.upsert.mockReset();
  prismaMock.organizationMembership.upsert.mockResolvedValue({
    role: "owner",
  });
  prismaMock.user.create.mockReset();
  prismaMock.user.update.mockReset();
  prismaMock.user.findUnique.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONSOLE_AUTH_PROVIDER;
  delete process.env.MOCK_CLERK_USER_ID;
  delete process.env.MOCK_CLERK_USER_EMAIL;
  delete process.env.MOCK_CLERK_USER_NAME;
  delete process.env.MOCK_CLERK_ORG_ID;
});

describe("getCompletedOrganizationScope — mock provider user bootstrap", () => {
  it("does not overwrite an already-edited name for an existing clerkUserId row", async () => {
    // The row already exists with a name the user edited away from the
    // MOCK_CLERK_USER_NAME env default — exactly the state right after a
    // successful updateProfileNameAction save.
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user_row_1",
      clerkUserId: "user_demo",
      email: "recruiter@hirecall.ai",
      name: "Ada Lovelace",
    });

    await getCompletedOrganizationScope();

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("still bootstraps a brand-new mock user from the env defaults", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // by clerkUserId — not found
      .mockResolvedValueOnce(null); // by email — not found
    prismaMock.user.create.mockResolvedValue({
      id: "user_row_new",
      clerkUserId: "user_demo",
      email: "recruiter@hirecall.ai",
      name: "Adrien Kouyate",
    });

    await getCompletedOrganizationScope();

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: {
        clerkUserId: "user_demo",
        email: "recruiter@hirecall.ai",
        name: "Adrien Kouyate",
      },
    });
  });
});
