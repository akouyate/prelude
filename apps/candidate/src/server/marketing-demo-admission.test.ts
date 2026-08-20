import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  candidateExperiencePreview: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  marketingDemoControl: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  marketingDemoDailyUsage: {
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  marketingDemoLaunch: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  marketingDemoRole: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((operation: (client: typeof tx) => unknown) =>
    operation(tx),
  ),
  candidateExperiencePreview: {
    updateMany: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));

import {
  confirmMarketingDemoProvisioning,
  createMarketingDemoPreview,
  listMarketingDemoRoles,
  releaseMarketingDemoStart,
  reserveMarketingDemoStart,
} from "./marketing-demo-admission";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "https://candidate.hirecall.test");
  vi.stubEnv(
    "MARKETING_DEMO_RETURN_TARGETS",
    "https://www.hirecall.test/demo/result",
  );
  vi.stubEnv(
    "MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY",
    Buffer.alloc(32, 7).toString("base64"),
  );
  tx.marketingDemoControl.findUnique.mockResolvedValue(control());
  tx.marketingDemoControl.update.mockResolvedValue(control());
  tx.marketingDemoLaunch.findMany.mockResolvedValue([]);
  tx.marketingDemoLaunch.updateMany.mockResolvedValue({ count: 1 });
  tx.marketingDemoRole.findMany.mockResolvedValue([roleRow()]);
  tx.marketingDemoRole.findUnique.mockResolvedValue(roleWithDraft());
  tx.candidateExperiencePreview.findUnique.mockResolvedValue({
    expiresAt: new Date("2026-08-20T10:10:00.000Z"),
    liveTestCount: 0,
    revokedAt: null,
    runtimeExpiresAt: null,
    snapshot: marketingSnapshot(),
  });
  tx.candidateExperiencePreview.count.mockResolvedValue(0);
  tx.candidateExperiencePreview.create.mockResolvedValue({});
  tx.candidateExperiencePreview.updateMany.mockResolvedValue({ count: 1 });
  tx.marketingDemoDailyUsage.upsert.mockResolvedValue({ startedCount: 0 });
  tx.marketingDemoDailyUsage.update.mockResolvedValue({});
  tx.marketingDemoDailyUsage.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.candidateExperiencePreview.updateMany.mockResolvedValue({
    count: 1,
  });
});

describe("marketing demo admission", () => {
  it("exposes only public role-card metadata and a digest-only launch nonce", async () => {
    const result = await listMarketingDemoRoles(
      new Date("2026-08-20T10:00:00.000Z"),
    );

    expect(result.roles).toEqual([
      {
        badge: "Sales",
        locale: "en",
        slug: "account-executive",
        summary: "Practice a sales interview.",
        title: "Account Executive",
        version: 1,
      },
    ]);
    expect(result.launchNonce).toMatch(/^mdln_[A-Za-z0-9_-]+$/);
    const launchCreate = tx.marketingDemoLaunch.create.mock.calls[0]?.[0].data;
    expect(launchCreate.nonceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("draft_");
    expect(JSON.stringify(result)).not.toContain("organization");
  });

  it("mints a marketing variant from the allow-listed active role, never request plan data", async () => {
    const result = await createMarketingDemoPreview(
      {
        launchNonce: `mdln_${"a".repeat(43)}`,
        returnTarget: "https://www.hirecall.test/demo/result",
        roleSlug: "account-executive",
      },
      new Date("2026-08-20T10:00:00.000Z"),
    );

    expect(result.previewUrl).toMatch(
      /^https:\/\/candidate\.hirecall\.test\/preview\/pvtk_/,
    );
    const created =
      tx.candidateExperiencePreview.create.mock.calls[0]?.[0].data;
    expect(created).toMatchObject({
      createdByUserId: "user_marketing_demo_system",
      liveTestCount: 0,
      schemaVersion: 2,
      snapshot: {
        variant: "marketing_demo",
        marketingDemo: {
          roleSlug: "account-executive",
          returnTarget: "https://www.hirecall.test/demo/result",
        },
      },
    });
    expect(created.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(created.tokenDigest).not.toContain("pvtk_");
    expect(tx.marketingDemoLaunch.updateMany).toHaveBeenCalledWith({
      data: { usedAt: new Date("2026-08-20T10:00:00.000Z") },
      where: expect.objectContaining({ usedAt: null }),
    });
  });

  it("rejects a return target that is not an exact allow-list member", async () => {
    await expect(
      createMarketingDemoPreview({
        launchNonce: `mdln_${"a".repeat(43)}`,
        returnTarget: "https://www.hirecall.test/demo/result/evil",
        roleSlug: "account-executive",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_target", status: 400 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("fails before nonce consumption when the encrypted relay is unavailable", async () => {
    vi.stubEnv("MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY", "");

    await expect(
      createMarketingDemoPreview({
        launchNonce: `mdln_${"a".repeat(43)}`,
        returnTarget: "https://www.hirecall.test/demo/result",
        roleSlug: "account-executive",
      }),
    ).rejects.toMatchObject({
      code: "demo_handoff_unavailable",
      status: 503,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.marketingDemoLaunch.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when the request-time database kill switch is off", async () => {
    tx.marketingDemoControl.findUnique.mockResolvedValueOnce({
      ...control(),
      enabled: false,
    });

    await expect(listMarketingDemoRoles()).rejects.toMatchObject({
      code: "demo_unavailable",
      status: 503,
    });
    expect(tx.marketingDemoLaunch.create).not.toHaveBeenCalled();
  });

  it("allows one atomic start and rejects the token race loser", async () => {
    tx.candidateExperiencePreview.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await reserveMarketingDemoStart(
      "pv_demo",
      new Date("2026-08-20T10:00:00.000Z"),
    );
    await expect(
      reserveMarketingDemoStart(
        "pv_demo",
        new Date("2026-08-20T10:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "demo_already_started", status: 409 });

    expect(first.runtimeExpiresAt).toEqual(
      new Date("2026-08-20T10:12:00.000Z"),
    );
    expect(tx.marketingDemoDailyUsage.update).toHaveBeenCalledTimes(1);
  });

  it("stops before preview reservation at global concurrency and daily caps", async () => {
    const now = new Date("2026-08-20T10:00:00.000Z");
    tx.candidateExperiencePreview.count.mockResolvedValueOnce(2);
    await expect(
      reserveMarketingDemoStart("pv_demo", now),
    ).rejects.toMatchObject({
      code: "demo_concurrency_cap_reached",
      status: 429,
    });
    expect(tx.candidateExperiencePreview.updateMany).not.toHaveBeenCalled();

    tx.candidateExperiencePreview.count.mockResolvedValueOnce(0);
    tx.marketingDemoDailyUsage.upsert.mockResolvedValueOnce({
      startedCount: 25,
    });
    await expect(
      reserveMarketingDemoStart("pv_demo", now),
    ).rejects.toMatchObject({
      code: "demo_daily_cap_reached",
      status: 429,
    });
    expect(tx.candidateExperiencePreview.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks the active role allow-list immediately before realtime provisioning", async () => {
    tx.marketingDemoRole.findUnique.mockResolvedValueOnce({ enabled: false });

    await expect(
      reserveMarketingDemoStart(
        "pv_demo",
        new Date("2026-08-20T10:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      code: "demo_role_not_found",
      status: 404,
    });
    expect(tx.candidateExperiencePreview.count).not.toHaveBeenCalled();
    expect(tx.candidateExperiencePreview.updateMany).not.toHaveBeenCalled();
  });

  it("releases the cap only when provisioning failed before a usable room", async () => {
    await releaseMarketingDemoStart({
      day: new Date("2026-08-20T00:00:00.000Z"),
      previewId: "pv_demo",
      runtimeExpiresAt: new Date("2026-08-20T10:12:00.000Z"),
    });

    expect(tx.candidateExperiencePreview.updateMany).toHaveBeenCalledWith({
      data: {
        completedAt: null,
        liveTestCount: 0,
        runtimeExpiresAt: null,
        startedAt: null,
      },
      where: expect.objectContaining({
        liveTestCount: 1,
        realtimeSessionId: null,
      }),
    });
    expect(tx.marketingDemoDailyUsage.updateMany).toHaveBeenCalledWith({
      data: { startedCount: { decrement: 1 } },
      where: expect.objectContaining({ startedCount: { gt: 0 } }),
    });
  });

  it("binds the only usable realtime session back to the preview", async () => {
    await confirmMarketingDemoProvisioning({
      previewId: "pv_demo",
      realtimeSessionId: "is_demo",
      runtimeExpiresAt: new Date("2026-08-20T10:12:00.000Z"),
    });
    expect(
      prismaMock.candidateExperiencePreview.updateMany,
    ).toHaveBeenCalledWith({
      data: { realtimeSessionId: "is_demo" },
      where: expect.objectContaining({
        id: "pv_demo",
        liveTestCount: 1,
        realtimeSessionId: null,
      }),
    });
  });
});

function control() {
  return {
    concurrentSessionCap: 2,
    dailyStartedSessionCap: 25,
    enabled: true,
    id: "global",
  };
}

function roleRow() {
  return {
    displayOrder: 10,
    enabled: true,
    locale: "en",
    publicBadge: "Sales",
    publicSummary: "Practice a sales interview.",
    publicTitle: "Account Executive",
    slug: "account-executive",
    version: 1,
  };
}

function roleWithDraft() {
  return {
    ...roleRow(),
    draftId: "draft_demo",
    postInterviewQuestions:
      marketingSnapshot().marketingDemo.postInterviewQuestions,
    draft: {
      criteria: marketingSnapshot().plan.criteria,
      estimatedMinutes: 8,
      focus: marketingSnapshot().plan.focus,
      guardrails: [],
      job: { title: "Account Executive" },
      jobId: "job_demo",
      language: "en",
      organization: { name: "HireCall" },
      organizationId: "org_marketing_demo_system",
      questions: marketingSnapshot().plan.questions,
      rationale: "Demo",
      responseModes: ["audio"],
      roleBrief: "Own discovery and sales execution.",
      roleTitle: "Account Executive",
      schemaVersion: 1,
      seniority: "mid",
    },
  };
}

function marketingSnapshot() {
  return {
    companyName: "HireCall",
    jobId: "job_demo",
    jobTitle: "Account Executive",
    schemaVersion: 2 as const,
    variant: "marketing_demo" as const,
    marketingDemo: {
      launchNonceDigest: "a".repeat(64),
      locale: "en" as const,
      postInterviewQuestions: [
        {
          id: "confidence",
          max: 5,
          maxLabel: "Very confident",
          min: 1,
          minLabel: "Not confident",
          prompt: "How confident did you feel?",
          required: true,
          type: "scale" as const,
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
      estimatedMinutes: 8,
      focus: ["role_skills"],
      guardrails: [],
      language: "en",
      questions: [
        {
          category: "experience",
          id: "question_1",
          prompt: "Tell me about a discovery call that changed your approach.",
        },
      ],
      rationale: "Demo",
      responseModes: ["audio"],
      roleBrief: "Own discovery and sales execution.",
      roleTitle: "Account Executive",
      schemaVersion: 1,
      seniority: "mid",
    },
  };
}
