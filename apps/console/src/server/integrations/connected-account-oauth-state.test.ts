import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  signConnectedAccountOAuthState,
  verifyConnectedAccountOAuthState,
} from "./connected-account-oauth-state";

const source = {
  CONNECTED_ACCOUNT_STATE_SECRET: "state-secret",
  NODE_ENV: "test",
};

describe("connected account OAuth state", () => {
  it("round-trips a signed state payload", () => {
    const signed = signConnectedAccountOAuthState(
      {
        capability: "calendar",
        expiresAt: Date.now() + 60_000,
        nonce: "nonce",
        organizationId: "org_1",
        provider: "google",
        returnTo: "/settings?view=integrations",
        userId: "user_1",
        v: 1,
      },
      source,
    );

    expect(verifyConnectedAccountOAuthState(signed, source)).toMatchObject({
      capability: "calendar",
      organizationId: "org_1",
      provider: "google",
      userId: "user_1",
    });
  });

  it("rejects tampered state", () => {
    const signed = signConnectedAccountOAuthState(
      {
        capability: "calendar",
        expiresAt: Date.now() + 60_000,
        nonce: "nonce",
        organizationId: "org_1",
        provider: "google",
        returnTo: "/settings?view=integrations",
        userId: "user_1",
        v: 1,
      },
      source,
    );

    expect(() =>
      verifyConnectedAccountOAuthState(`${signed}x`, source),
    ).toThrow(/Invalid OAuth state/u);
  });

  it("rejects expired state", () => {
    const signed = signConnectedAccountOAuthState(
      {
        capability: "calendar",
        expiresAt: Date.now() - 1,
        nonce: "nonce",
        organizationId: "org_1",
        provider: "google",
        returnTo: "/settings?view=integrations",
        userId: "user_1",
        v: 1,
      },
      source,
    );

    expect(() => verifyConnectedAccountOAuthState(signed, source)).toThrow(
      /expired/u,
    );
  });
});
