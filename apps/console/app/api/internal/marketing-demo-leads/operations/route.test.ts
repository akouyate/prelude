import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  processMarketingDemoLeadOperations: vi.fn(),
}));

vi.mock(
  "../../../../../src/server/marketing-demos/marketing-demo-leads",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../../../src/server/marketing-demos/marketing-demo-leads")
    >("../../../../../src/server/marketing-demos/marketing-demo-leads");
    return {
      ...actual,
      processMarketingDemoLeadOperations:
        operations.processMarketingDemoLeadOperations,
    };
  },
);

import { POST } from "./route";

const secret = "o".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MARKETING_DEMO_LEAD_OPERATIONS_SECRET", secret);
  operations.processMarketingDemoLeadOperations.mockResolvedValue({
    delivered: 1,
    failed: 0,
    removed: 2,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/marketing-demo-leads/operations", () => {
  it("fails closed while the scheduler secret is absent or too short", async () => {
    vi.stubEnv("MARKETING_DEMO_LEAD_OPERATIONS_SECRET", "short");

    const response = await POST(request({ authorization: "Bearer short" }));

    expect(response.status).toBe(503);
    expect(
      operations.processMarketingDemoLeadOperations,
    ).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer", async () => {
    const response = await POST(
      request({ authorization: `Bearer ${"x".repeat(32)}` }),
    );

    expect(response.status).toBe(401);
    expect(
      operations.processMarketingDemoLeadOperations,
    ).not.toHaveBeenCalled();
  });

  it("runs delivery and retention with a bounded limit", async () => {
    const response = await POST(request({ query: "?limit=25" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      delivered: 1,
      failed: 0,
      removed: 2,
    });
    expect(operations.processMarketingDemoLeadOperations).toHaveBeenCalledWith({
      limit: 25,
    });
  });

  it("rejects unbounded limits", async () => {
    const response = await POST(request({ query: "?limit=201" }));

    expect(response.status).toBe(400);
    expect(
      operations.processMarketingDemoLeadOperations,
    ).not.toHaveBeenCalled();
  });
});

function request({
  authorization = `Bearer ${secret}`,
  query = "",
}: { authorization?: string; query?: string } = {}) {
  const headers = new Headers({ authorization });
  return {
    headers,
    nextUrl: new URL(
      `https://console.test/api/internal/marketing-demo-leads/operations${query}`,
    ),
  } as unknown as Parameters<typeof POST>[0];
}
