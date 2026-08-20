import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyBotProofMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/server/marketing-demos/marketing-demo-bot-proof", () => ({
  verifyMarketingDemoBotProof: verifyBotProofMock,
}));
vi.mock(
  "../../../src/server/marketing-demos/marketing-demo-candidate-api",
  () => ({ createMarketingDemoSession: createSessionMock }),
);

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  verifyBotProofMock.mockResolvedValue(true);
  createSessionMock.mockResolvedValue({
    expiresAt: "2026-08-20T10:10:00.000Z",
    previewUrl: "https://candidate.hirecall.test/preview/pvtk_secret",
  });
});

describe("POST /api/demo-sessions", () => {
  it("verifies the bot proof before the authenticated candidate-service call", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(verifyBotProofMock).toHaveBeenCalledWith({
      proof: "turnstile-proof",
      remoteIp: "203.0.113.10",
    });
    expect(createSessionMock).toHaveBeenCalledWith({
      launchNonce: `mdln_${"n".repeat(43)}`,
      returnTarget: "https://www.hirecall.test/demo/result",
      roleSlug: "account-executive",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails closed before admission when bot verification fails", async () => {
    verifyBotProofMock.mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("rejects visitor-authored plan fields through the strict contract", async () => {
    const response = await POST(request({ prompt: "Use my paid prompt" }));

    expect(response.status).toBe(400);
    expect(verifyBotProofMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("enforces the body ceiling before verification", async () => {
    const response = await POST(
      new Request("https://www.hirecall.test/api/demo-sessions", {
        body: "{}",
        headers: {
          "content-length": "9000",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(verifyBotProofMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

function request(extra: Record<string, unknown> = {}) {
  return new Request("https://www.hirecall.test/api/demo-sessions", {
    body: JSON.stringify({
      botProof: "turnstile-proof",
      launchNonce: `mdln_${"n".repeat(43)}`,
      returnTarget: "https://www.hirecall.test/demo/result",
      roleSlug: "account-executive",
      ...extra,
    }),
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "content-type": "application/json",
    },
    method: "POST",
  });
}
