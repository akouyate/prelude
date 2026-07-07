import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { connectedAccount } = vi.hoisted(() => ({
  connectedAccount: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({
  prisma: { connectedAccount },
}));

import {
  getConnectedAccountCapabilityStatus,
  listConnectedAccountSummaries,
} from "./connected-account-service";

describe("connected account service", () => {
  beforeEach(() => {
    connectedAccount.findMany.mockReset();
    connectedAccount.findUnique.mockReset();
  });

  it("loads persisted accounts as token-redacted summaries", async () => {
    connectedAccount.findMany.mockResolvedValue([
      {
        accessTokenCiphertext: "encrypted-access",
        accessTokenExpiresAt: new Date("2026-07-07T13:00:00Z"),
        capabilities: ["calendar"],
        connectedAt: new Date("2026-07-07T12:00:00Z"),
        disconnectedAt: null,
        externalAccountEmail: "recruiter@example.com",
        externalAccountId: "google-sub",
        id: "connection_1",
        provider: "google",
        refreshTokenCiphertext: "encrypted-refresh",
        scopes: ["openid", "email"],
        status: "connected",
      },
    ]);

    await expect(
      listConnectedAccountSummaries({
        organizationId: "org_1",
        userId: "user_1",
      }),
    ).resolves.toEqual([
      {
        capabilities: ["calendar"],
        connectedAt: new Date("2026-07-07T12:00:00Z"),
        disconnectedAt: null,
        externalAccountEmail: "recruiter@example.com",
        externalAccountId: "google-sub",
        id: "connection_1",
        provider: "google",
        scopes: ["openid", "email"],
        status: "connected",
      },
    ]);
    expect(connectedAccount.findMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
      where: { organizationId: "org_1", userId: "user_1" },
    });
  });

  it("lets features query a capability without knowing OAuth storage", async () => {
    connectedAccount.findUnique.mockResolvedValue({
      accessTokenExpiresAt: new Date("2026-07-07T13:00:00Z"),
      capabilities: ["calendar"],
      id: "connection_1",
      provider: "google",
      refreshTokenCiphertext: "encrypted-refresh",
      scopes: ["openid"],
      status: "connected",
    });

    await expect(
      getConnectedAccountCapabilityStatus({
        capability: "calendar",
        organizationId: "org_1",
        provider: "google",
        userId: "user_1",
      }),
    ).resolves.toBe("connected");
  });
});
