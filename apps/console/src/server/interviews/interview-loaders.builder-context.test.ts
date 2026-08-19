import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  interviewDraft: { findFirst: vi.fn() },
  job: { findFirst: vi.fn() },
  organization: { findUniqueOrThrow: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("../organizations/organization-scope", () => ({
  getCompletedOrganizationScope: vi.fn(async () => ({
    organizationId: "org_1",
    role: "recruiter",
    userId: "user_1",
  })),
}));

import { getInterviewBuilderContext } from "./interview-loaders";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.interviewDraft.findFirst.mockResolvedValue(null);
  prismaMock.job.findFirst.mockResolvedValue(null);
});

// The two language facts the builder needs are NOT interchangeable: the
// interview default seeds the per-draft, candidate-bound stamp, while the
// workspace language drives the recruiter-bound copy the builder writes
// client-side (plan 2026-08-18, rule 1). Pinned here because the builder itself
// has no component-test harness in this app.
describe("getInterviewBuilderContext language facts", () => {
  it("exposes the interview default and the workspace language separately", async () => {
    prismaMock.organization.findUniqueOrThrow.mockResolvedValue({
      name: "HireCall",
      settings: {
        interview: { defaultLanguage: "fr" },
        workspaceLanguage: "en",
      },
    });

    const context = await getInterviewBuilderContext({});

    expect(context.defaultInterviewLanguage).toBe("fr");
    expect(context.workspaceLanguage).toBe("en");
  });

  it("falls back to English for a workspace that never set either", async () => {
    prismaMock.organization.findUniqueOrThrow.mockResolvedValue({
      name: "HireCall",
      settings: {},
    });

    const context = await getInterviewBuilderContext({});

    expect(context.defaultInterviewLanguage).toBe("en");
    expect(context.workspaceLanguage).toBe("en");
  });

  it("carries both onto the persisted-draft path too", async () => {
    prismaMock.organization.findUniqueOrThrow.mockResolvedValue({
      name: "HireCall",
      settings: {
        interview: { defaultLanguage: "en" },
        workspaceLanguage: "fr",
      },
    });
    prismaMock.interviewDraft.findFirst.mockResolvedValue({
      criteria: [],
      estimatedMinutes: 6,
      focus: [],
      guardrails: [],
      id: "draft_1",
      job: { location: "Paris" },
      jobId: "job_1",
      language: "fr",
      questions: [],
      rationale: "",
      responseModes: [],
      roleBrief: "brief",
      roleTitle: "Backend Engineer",
      seniority: "mid",
      sourceAttachmentName: null,
    });

    const context = await getInterviewBuilderContext({ draftId: "draft_1" });

    expect(context.workspaceLanguage).toBe("fr");
    expect(context.defaultInterviewLanguage).toBe("en");
    // The draft's own stamp is passed through untouched — never coerced to the
    // workspace default on read (rule 6: no backfill, not even in memory).
    expect(context.initialDraft?.language).toBe("fr");
  });
});
