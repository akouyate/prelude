import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@prelude/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prelude/db")>();
  return { ...actual, prisma: prismaMock };
});
vi.mock("server-only", () => ({}));

import { Prisma } from "@prelude/db";

import { prismaClerkSyncStore } from "./clerk-webhook-store";

function uniqueConstraintError(target: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`${target}\`)`,
    { code: "P2002", clientVersion: "6.19.3", meta: { target: [target] } },
  );
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): clearAllMocks only wipes call/result
  // history and leaves queued `mockResolvedValueOnce`/`mockRejectedValueOnce`
  // entries in place, which would leak from one test's queue into the next.
  vi.resetAllMocks();
});

describe("prismaClerkSyncStore.upsertUser — item 4: identity hijack via email match", () => {
  it("refuses to reassign an email-matched row that already belongs to a DIFFERENT Clerk identity", async () => {
    // No row carries the incoming clerkUserId yet ...
    prismaMock.user.findUnique.mockImplementation(({ where }) => {
      if ("clerkUserId" in where) return Promise.resolve(null);
      if ("email" in where) {
        // ... but a row with this email already exists, and it is already
        // linked to a DIFFERENT Clerk account. Two Clerk accounts sharing an
        // email (email change, instance migration, delete + re-signup) must
        // not let the second one take over the first's identity and every
        // OrganizationMembership on it.
        return Promise.resolve({
          id: "user_db_existing",
          clerkUserId: "user_clerk_OTHER",
        });
      }
      return Promise.resolve(null);
    });

    await expect(
      prismaClerkSyncStore.upsertUser({
        clerkUserId: "user_clerk_NEW",
        email: "shared@example.com",
        name: "Someone",
      }),
    ).rejects.toThrow();

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("still adopts an email-matched row when its clerkUserId is null (a legitimately lazy-provisioned row)", async () => {
    prismaMock.user.findUnique.mockImplementation(({ where }) => {
      if ("clerkUserId" in where) return Promise.resolve(null);
      if ("email" in where) {
        return Promise.resolve({ id: "user_db_existing", clerkUserId: null });
      }
      return Promise.resolve(null);
    });
    prismaMock.user.update.mockResolvedValue({});

    const id = await prismaClerkSyncStore.upsertUser({
      clerkUserId: "user_clerk_NEW",
      email: "invited@example.com",
      name: "Invited Person",
    });

    expect(id).toBe("user_db_existing");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user_db_existing" },
      data: { clerkUserId: "user_clerk_NEW", name: "Invited Person" },
    });
  });
});

describe("prismaClerkSyncStore.updateUserProfile — item 4 related: email-collision retry storm", () => {
  it("parks an email collision (P2002) instead of throwing into an infinite Svix retry loop", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user_db_1" });
    prismaMock.user.update
      .mockRejectedValueOnce(uniqueConstraintError("email"))
      .mockResolvedValueOnce({});
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const applied = await prismaClerkSyncStore.updateUserProfile({
      clerkUserId: "user_clerk_1",
      email: "taken@example.com",
      name: "New Name",
    });

    // Reports success (a non-retrying outcome) rather than throwing — a
    // retry would hit the exact same P2002 forever until Svix disables the
    // endpoint, taking every other event down with it.
    expect(applied).toBe(true);
    // The conflicting email is not what's applied on the retry.
    expect(prismaMock.user.update).toHaveBeenLastCalledWith({
      where: { id: "user_db_1" },
      data: { name: "New Name" },
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("still throws (so Svix retries) on a non-collision database error", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user_db_1" });
    prismaMock.user.update.mockRejectedValue(new Error("connection reset"));

    await expect(
      prismaClerkSyncStore.updateUserProfile({
        clerkUserId: "user_clerk_1",
        email: "new@example.com",
        name: "New Name",
      }),
    ).rejects.toThrow("connection reset");
  });
});
