import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMarketingDemoRoles } from "./marketing-demo-candidate-api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("marketing demo candidate service transport", () => {
  it("never sends the service bearer over plaintext in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "http://candidate.internal");
    vi.stubEnv("MARKETING_DEMO_SERVICE_SECRET", "service-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMarketingDemoRoles()).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
