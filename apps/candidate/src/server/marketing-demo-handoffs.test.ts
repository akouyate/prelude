import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  candidateExperiencePreview: { deleteMany: vi.fn() },
  liveInterviewSession: { deleteMany: vi.fn(), findMany: vi.fn() },
  marketingDemoHandoff: { deleteMany: vi.fn() },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((operation: (client: typeof tx) => unknown) =>
    operation(tx),
  ),
  candidateExperiencePreview: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  liveInterviewSession: { findFirst: vi.fn() },
  marketingDemoHandoff: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));

import {
  createMarketingDemoHandoff,
  exchangeMarketingDemoHandoff,
} from "./marketing-demo-handoffs";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv(
    "MARKETING_DEMO_RETURN_TARGETS",
    "https://www.hirecall.test/demo/result",
  );
  vi.stubEnv(
    "MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY",
    Buffer.alloc(32, 7).toString("base64"),
  );
  prismaMock.candidateExperiencePreview.findUnique.mockResolvedValue(
    previewRow(),
  );
  prismaMock.liveInterviewSession.findFirst.mockResolvedValue({
    id: "is_demo",
    status: "completed",
  });
  prismaMock.marketingDemoHandoff.create.mockResolvedValue({});
  prismaMock.marketingDemoHandoff.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.candidateExperiencePreview.updateMany.mockResolvedValue({
    count: 1,
  });
  tx.marketingDemoHandoff.deleteMany.mockResolvedValue({ count: 1 });
  tx.liveInterviewSession.findMany.mockResolvedValue([{ id: "is_demo" }]);
  tx.liveInterviewSession.deleteMany.mockResolvedValue({ count: 1 });
  tx.candidateExperiencePreview.deleteMany.mockResolvedValue({ count: 1 });
});

describe("marketing demo handoff relay", () => {
  it("encrypts completion metadata, erases realtime events, and returns only an opaque code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMarketingDemoHandoff(
      {
        previewToken: `pvtk_${"s".repeat(43)}`,
        sessionId: "is_demo",
      },
      new Date("2026-08-20T10:05:00.000Z"),
    );

    const created =
      prismaMock.marketingDemoHandoff.create.mock.calls[0]?.[0].data;
    expect(created.codeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(created.encryptedPayload).not.toContain("account-executive");
    expect(result.handoffUrl).toMatch(
      /^https:\/\/www\.hirecall\.test\/demo\/result\?handoff=mdho_/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/personal-data");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(
      prismaMock.candidateExperiencePreview.updateMany,
    ).toHaveBeenCalledWith({
      data: {
        completedAt: new Date("2026-08-20T10:05:00.000Z"),
        runtimeExpiresAt: new Date("2026-08-20T10:10:00.000Z"),
      },
      where: { id: "pv_demo", realtimeSessionId: "is_demo" },
    });
  });

  it("consumes once and deletes relay, runtime session, and preview immediately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    await createMarketingDemoHandoff({
      previewToken: `pvtk_${"s".repeat(43)}`,
      sessionId: "is_demo",
    });
    const created =
      prismaMock.marketingDemoHandoff.create.mock.calls[0]?.[0].data;
    prismaMock.marketingDemoHandoff.findUnique.mockResolvedValue({
      ...created,
      previewId: "pv_demo",
      returnTarget: "https://www.hirecall.test/demo/result",
    });

    const result = await exchangeMarketingDemoHandoff({
      code: "mdho_one_use_secret_abcdefghijklmnopqrstuvwxyz",
      returnTarget: "https://www.hirecall.test/demo/result",
    });

    expect(result).toEqual({
      completed: true,
      roleSlug: "account-executive",
      roleTitle: "Account Executive",
      roleVersion: 1,
    });
    expect(result).not.toHaveProperty("answers");
    expect(result).not.toHaveProperty("transcript");
    expect(tx.marketingDemoHandoff.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        expiresAt: { gt: expect.any(Date) },
        returnTarget: "https://www.hirecall.test/demo/result",
      }),
    });
    expect(tx.liveInterviewSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["is_demo"] } },
    });
    expect(tx.candidateExperiencePreview.deleteMany).toHaveBeenCalledWith({
      where: { id: "pv_demo" },
    });

    tx.marketingDemoHandoff.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      exchangeMarketingDemoHandoff({
        code: "mdho_one_use_secret_abcdefghijklmnopqrstuvwxyz",
        returnTarget: "https://www.hirecall.test/demo/result",
      }),
    ).rejects.toMatchObject({ code: "handoff_not_found", status: 404 });
  });

  it("fails closed and removes the relay if terminal transcript cleanup is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })),
    );

    await expect(
      createMarketingDemoHandoff({
        previewToken: `pvtk_${"s".repeat(43)}`,
        sessionId: "is_demo",
      }),
    ).rejects.toMatchObject({ code: "demo_cleanup_unavailable", status: 503 });
    expect(prismaMock.marketingDemoHandoff.deleteMany).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^mdh_/) },
    });
  });

  it("removes the relay if preview completion cannot be persisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
    prismaMock.candidateExperiencePreview.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      createMarketingDemoHandoff({
        previewToken: `pvtk_${"s".repeat(43)}`,
        sessionId: "is_demo",
      }),
    ).rejects.toMatchObject({ code: "demo_handoff_unavailable", status: 503 });
    expect(prismaMock.marketingDemoHandoff.deleteMany).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^mdh_/) },
    });
  });

  it("rejects exchange to a same-origin but non-allow-listed path", async () => {
    await expect(
      exchangeMarketingDemoHandoff({
        code: "mdho_one_use_secret_abcdefghijklmnopqrstuvwxyz",
        returnTarget: "https://www.hirecall.test/demo/result/other",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_target", status: 400 });
    expect(prismaMock.marketingDemoHandoff.findUnique).not.toHaveBeenCalled();
  });
});

function previewRow() {
  return {
    expiresAt: new Date("2026-08-20T10:10:00.000Z"),
    id: "pv_demo",
    realtimeSessionId: "is_demo",
    runtimeExpiresAt: new Date("2099-08-20T10:12:00.000Z"),
    snapshot: {
      companyName: "HireCall",
      jobId: "job_demo",
      jobTitle: "Account Executive",
      schemaVersion: 2,
      variant: "marketing_demo",
      marketingDemo: {
        launchNonceDigest: "a".repeat(64),
        locale: "en",
        postInterviewQuestions: [
          {
            id: "confidence",
            max: 5,
            maxLabel: "Very confident",
            min: 1,
            minLabel: "Not confident",
            prompt: "How confident did you feel?",
            required: true,
            type: "scale",
          },
        ],
        returnTarget: "https://www.hirecall.test/demo/result",
        roleSlug: "account-executive",
        roleVersion: 1,
      },
      plan: {
        criteria: [
          {
            description: "Explains a concrete customer investigation.",
            id: "criterion_1",
            label: "Discovery",
          },
        ],
        focus: ["role_skills"],
        guardrails: [],
        language: "en",
        questions: [
          {
            id: "question_1",
            prompt: "Tell me about a customer story you are proud of.",
          },
        ],
        responseModes: ["audio"],
        roleBrief: "Own discovery.",
        roleTitle: "Account Executive",
        schemaVersion: 1,
      },
    },
  };
}
