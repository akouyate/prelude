import { beforeEach, describe, expect, it, vi } from "vitest";

const leadService = vi.hoisted(() => ({
  captureMarketingDemoLead: vi.fn(),
}));

vi.mock(
  "../../../src/server/marketing-demos/marketing-demo-leads",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../src/server/marketing-demos/marketing-demo-leads")
    >("../../../src/server/marketing-demos/marketing-demo-leads");
    return {
      ...actual,
      captureMarketingDemoLead: leadService.captureMarketingDemoLead,
    };
  },
);

import { MarketingDemoLeadError } from "../../../src/server/marketing-demos/marketing-demo-leads";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  leadService.captureMarketingDemoLead.mockResolvedValue({ accepted: true });
});

describe("POST /api/demo-leads", () => {
  it("passes only the strict capture contract to the service", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(leadService.captureMarketingDemoLead).toHaveBeenCalledWith({
      captureToken: `mdlc_${"l".repeat(43)}`,
      email: "buyer@example.com",
      marketingConsent: true,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("enforces the body ceiling before parsing", async () => {
    const response = await POST(
      new Request("https://www.hirecall.test/api/demo-leads", {
        body: "{}",
        headers: { "content-length": "5000" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(leadService.captureMarketingDemoLead).not.toHaveBeenCalled();
  });

  it("returns stable, non-sensitive service errors", async () => {
    leadService.captureMarketingDemoLead.mockRejectedValueOnce(
      new MarketingDemoLeadError("lead_capture_rate_limited", 429),
    );

    const response = await POST(request());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: "lead_capture_rate_limited" },
    });
  });

  it("rejects invalid JSON", async () => {
    const response = await POST(
      new Request("https://www.hirecall.test/api/demo-leads", {
        body: "{",
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(leadService.captureMarketingDemoLead).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request("https://www.hirecall.test/api/demo-leads", {
    body: JSON.stringify({
      captureToken: `mdlc_${"l".repeat(43)}`,
      email: "buyer@example.com",
      marketingConsent: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
