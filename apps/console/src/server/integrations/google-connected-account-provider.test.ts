import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGoogleConnectedAccountProvider,
  googleCalendarEventsScope,
} from "./google-connected-account-provider";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/api/integrations/google/callback",
};

describe("google connected account provider", () => {
  it("builds a web-server OAuth URL with only identity and calendar scopes", async () => {
    const provider = createGoogleConnectedAccountProvider(config);
    const url = new URL(
      await provider.getAuthorizationUrl({
        capability: "calendar",
        loginHint: "recruiter@prelude.ai",
        state: "signed-state",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("login_hint")).toBe("recruiter@prelude.ai");

    const scopes = new Set(url.searchParams.get("scope")?.split(" "));
    expect(scopes.has("openid")).toBe(true);
    expect(scopes.has("email")).toBe(true);
    expect(scopes.has("profile")).toBe(true);
    expect(scopes.has(googleCalendarEventsScope)).toBe(true);
    expect([...scopes].some((scope) => scope.includes("gmail"))).toBe(false);
  });

  it("redacts provider token fields from thrown errors", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "access-secret",
          error: "invalid_grant",
          refresh_token: "refresh-secret",
        }),
        { status: 400 },
      );
    }) as typeof fetch;
    const provider = createGoogleConnectedAccountProvider(config, fetchImpl);

    await expect(
      provider.exchangeCode({ capability: "calendar", code: "bad-code" }),
    ).rejects.toThrow(/\[redacted\]/u);
    await expect(
      provider.exchangeCode({ capability: "calendar", code: "bad-code" }),
    ).rejects.not.toThrow(/access-secret|refresh-secret/u);
  });
});
