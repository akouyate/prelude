import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeHandoffMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../src/server/marketing-demo-handoffs", () => ({
  exchangeMarketingDemoHandoff: exchangeHandoffMock,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MARKETING_DEMO_SERVICE_SECRET", serviceSecret);
  exchangeHandoffMock.mockResolvedValue({
    completed: true,
    roleSlug: "account-executive",
    roleTitle: "Account Executive",
    roleVersion: 1,
  });
});

describe("POST /api/internal/marketing-demo-handoffs/exchange", () => {
  it("rejects an unsigned browser bypass before looking up the relay", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(exchangeHandoffMock).not.toHaveBeenCalled();
  });

  it("allows only the authenticated exact-target exchange contract", async () => {
    const response = await POST(request(serviceSecret));

    expect(response.status).toBe(200);
    expect(exchangeHandoffMock).toHaveBeenCalledWith({
      code: `mdho_${"c".repeat(43)}`,
      returnTarget: "https://www.hirecall.test/demo/result",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unknown fields before consuming a relay", async () => {
    const response = await POST(request(serviceSecret, { transcript: [] }));

    expect(response.status).toBe(400);
    expect(exchangeHandoffMock).not.toHaveBeenCalled();
  });
});

const serviceSecret = "s".repeat(40);

function request(secret?: string, extra: Record<string, unknown> = {}) {
  return new Request(
    "https://candidate.hirecall.test/api/internal/marketing-demo-handoffs/exchange",
    {
      body: JSON.stringify({
        code: `mdho_${"c".repeat(43)}`,
        returnTarget: "https://www.hirecall.test/demo/result",
        ...extra,
      }),
      headers: {
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}
