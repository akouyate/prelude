import { describe, expect, it } from "vitest";

import {
  getCapabilityStatus,
  toConnectedAccountSummary,
} from "./connected-account-types";

describe("connected account types", () => {
  it("keeps token ciphertext out of client summaries", () => {
    expect(
      toConnectedAccountSummary({
        accessTokenCiphertext: "encrypted-access",
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
        capabilities: ["calendar"],
        connectedAt: new Date("2026-07-07T08:00:00Z"),
        disconnectedAt: null,
        externalAccountEmail: "recruiter@example.com",
        externalAccountId: "google-sub",
        id: "connection_1",
        provider: "google",
        refreshTokenCiphertext: "encrypted-refresh",
        scopes: ["openid"],
        status: "connected",
      }),
    ).toEqual({
      capabilities: ["calendar"],
      connectedAt: new Date("2026-07-07T08:00:00Z"),
      disconnectedAt: null,
      externalAccountEmail: "recruiter@example.com",
      externalAccountId: "google-sub",
      id: "connection_1",
      provider: "google",
      scopes: ["openid"],
      status: "connected",
    });
  });

  it("represents missing, revoked, expired, and reconnect states", () => {
    const now = new Date("2026-07-07T09:00:00Z");

    expect(getCapabilityStatus(null, "calendar", now)).toBe("not_connected");
    expect(
      getCapabilityStatus(
        {
          accessTokenExpiresAt: new Date("2026-07-07T08:00:00Z"),
          capabilities: ["calendar"],
          id: "connection_1",
          provider: "google",
          refreshTokenCiphertext: null,
          scopes: [],
          status: "connected",
        },
        "calendar",
        now,
      ),
    ).toBe("expired");
    expect(
      getCapabilityStatus(
        {
          capabilities: ["calendar"],
          id: "connection_2",
          provider: "google",
          scopes: [],
          status: "needs_reconnect",
        },
        "calendar",
        now,
      ),
    ).toBe("needs_reconnect");
    expect(
      getCapabilityStatus(
        {
          capabilities: ["calendar"],
          id: "connection_3",
          provider: "google",
          scopes: [],
          status: "revoked",
        },
        "calendar",
        now,
      ),
    ).toBe("revoked");
  });
});
