import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowedMarketingDemoReturnTargets,
  isAllowedMarketingDemoReturnTarget,
} from "./marketing-demo-security";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("marketing demo environment controls", () => {
  it("does not synthesize a development return target in a Next production runtime", () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MARKETING_DEMO_RETURN_TARGETS", "");
    vi.stubEnv("NEXT_PUBLIC_CONSOLE_URL", "http://localhost:3000");

    expect(allowedMarketingDemoReturnTargets()).toEqual(new Set());
  });

  it("requires HTTPS for every production return target", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "MARKETING_DEMO_RETURN_TARGETS",
      "http://www.hirecall.test/demo/result,https://www.hirecall.test/demo/result",
    );

    expect(
      isAllowedMarketingDemoReturnTarget(
        "http://www.hirecall.test/demo/result",
      ),
    ).toBe(false);
    expect(
      isAllowedMarketingDemoReturnTarget(
        "https://www.hirecall.test/demo/result",
      ),
    ).toBe(true);
  });
});
