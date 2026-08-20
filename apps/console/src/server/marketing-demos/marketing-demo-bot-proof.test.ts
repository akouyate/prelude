import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyMarketingDemoBotProof } from "./marketing-demo-bot-proof";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("marketing demo bot proof", () => {
  it("fails closed in production when challenge controls are unavailable", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("MARKETING_DEMO_TURNSTILE_SECRET", "");
    vi.stubEnv("MARKETING_DEMO_TEST_BOT_PROOF", "test-proof");

    await expect(
      verifyMarketingDemoBotProof({ proof: "test-proof", remoteIp: null }),
    ).resolves.toBe(false);
  });

  it("also fails closed when Next marks the runtime as production", async () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MARKETING_DEMO_TURNSTILE_SECRET", "");
    vi.stubEnv("MARKETING_DEMO_TEST_BOT_PROOF", "test-proof");

    await expect(
      verifyMarketingDemoBotProof({ proof: "test-proof", remoteIp: null }),
    ).resolves.toBe(false);
  });

  it("allows only an explicit exact development proof when configured", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("MARKETING_DEMO_TURNSTILE_SECRET", "");
    vi.stubEnv("MARKETING_DEMO_TEST_BOT_PROOF", "local-proof");

    await expect(
      verifyMarketingDemoBotProof({ proof: "local-proof", remoteIp: null }),
    ).resolves.toBe(true);
    await expect(
      verifyMarketingDemoBotProof({ proof: "wrong", remoteIp: null }),
    ).resolves.toBe(false);
  });

  it("fails closed when Turnstile cannot verify the proof", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("MARKETING_DEMO_TURNSTILE_SECRET", "turnstile-secret");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      verifyMarketingDemoBotProof({ proof: "visitor-proof", remoteIp: null }),
    ).resolves.toBe(false);
  });

  it("accepts only a positive Turnstile response", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("MARKETING_DEMO_TURNSTILE_SECRET", "turnstile-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyMarketingDemoBotProof({
        proof: "visitor-proof",
        remoteIp: "203.0.113.4",
      }),
    ).resolves.toBe(true);
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("response")).toBe("visitor-proof");
    expect(body.get("remoteip")).toBe("203.0.113.4");
  });
});
