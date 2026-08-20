import { beforeEach, describe, expect, it, vi } from "vitest";

const createPreviewMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/server/marketing-demo-admission", () => ({
  createMarketingDemoPreview: createPreviewMock,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MARKETING_DEMO_SERVICE_SECRET", serviceSecret);
  createPreviewMock.mockResolvedValue({
    expiresAt: "2026-08-20T10:10:00.000Z",
    previewUrl: "https://candidate.hirecall.test/preview/pvtk_secret",
  });
});

describe("POST /api/internal/marketing-demo-sessions", () => {
  it("rejects a direct unsigned bypass before any database admission", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
    expect(createPreviewMock).not.toHaveBeenCalled();
  });

  it("fails closed on a weak website-to-candidate bearer", async () => {
    vi.stubEnv("MARKETING_DEMO_SERVICE_SECRET", "short-secret");

    const response = await POST(request("short-secret"));

    expect(response.status).toBe(401);
    expect(createPreviewMock).not.toHaveBeenCalled();
  });

  it("accepts only the service-authenticated, bot-verified bounded contract", async () => {
    const response = await POST(request(serviceSecret));

    expect(response.status).toBe(201);
    expect(createPreviewMock).toHaveBeenCalledWith({
      botProofVerified: true,
      launchNonce: `mdln_${"n".repeat(43)}`,
      returnTarget: "https://www.hirecall.test/demo/result",
      roleSlug: "account-executive",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unknown fields instead of accepting visitor-authored plan data", async () => {
    const response = await POST(
      request(serviceSecret, {
        plan: { questions: [{ prompt: "Arbitrary paid prompt" }] },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_demo_request" },
    });
    expect(createPreviewMock).not.toHaveBeenCalled();
  });

  it("enforces the body ceiling before parsing", async () => {
    const response = await POST(
      new Request(
        "http://candidate.test/api/internal/marketing-demo-sessions",
        {
          body: "{}",
          headers: {
            authorization: `Bearer ${serviceSecret}`,
            "content-length": "9000",
            "content-type": "application/json",
          },
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(413);
    expect(createPreviewMock).not.toHaveBeenCalled();
  });
});

const serviceSecret = "s".repeat(40);

function request(secret?: string, extra: Record<string, unknown> = {}) {
  return new Request(
    "http://candidate.test/api/internal/marketing-demo-sessions",
    {
      body: JSON.stringify({
        botProofVerified: true,
        launchNonce: `mdln_${"n".repeat(43)}`,
        returnTarget: "https://www.hirecall.test/demo/result",
        roleSlug: "account-executive",
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
