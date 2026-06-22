import { beforeEach, describe, expect, it, vi } from "vitest";

import { INTERVIEW_PLAN_SCHEMA_VERSION } from "@prelude/contracts";

const tx = vi.hoisted(() => ({
  job: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  interviewDraft: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("../organizations/organization-scope", () => ({
  getCompletedOrganizationScope: vi.fn(async () => ({
    organizationId: "org_123",
  })),
}));

import { saveInterviewDraft, type SaveInterviewDraftInput } from "./interview-drafts";

const baseInput = (): SaveInterviewDraftInput => ({
  criteria: [
    {
      id: "c1",
      label: "Problem solving",
      description: "Looks for concrete, job-related evidence.",
    },
    {
      id: "c2",
      label: "Communication",
      description: "Explains decisions clearly.",
    },
    {
      id: "c3",
      label: "Ownership",
      description: "Drives tasks to completion.",
    },
  ],
  estimatedMinutes: 12,
  focus: ["role_skills"],
  guardrails: ["Ask every candidate the same questions in the same order."],
  questions: [
    {
      category: "experience",
      durationSeconds: 75,
      expectedSignal: "Problem solving",
      id: "q1",
      maxFollowups: 1,
      prompt: "Describe a production incident you debugged end to end.",
      required: true,
      source: "agent",
    },
    {
      category: "custom",
      durationSeconds: 75,
      expectedSignal: "Communication",
      id: "q2",
      maxFollowups: 1,
      prompt: "Tell me about a time you communicated a tricky tradeoff.",
      required: true,
      source: "agent",
    },
  ],
  rationale: "Prepared focused first-screen questions.",
  responseModes: ["audio", "text"],
  roleBrief:
    "We are hiring a backend engineer to own services, debug incidents, and communicate clearly with the team.",
  roleTitle: "Backend Engineer",
  seniority: "mid",
});

beforeEach(() => {
  vi.clearAllMocks();
  tx.job.findFirst.mockResolvedValue(null);
  tx.job.create.mockResolvedValue({ id: "job_1" });
  tx.job.update.mockResolvedValue({ id: "job_1" });
  tx.interviewDraft.findFirst.mockResolvedValue(null);
  tx.interviewDraft.create.mockResolvedValue({
    id: "draft_1",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  tx.interviewDraft.update.mockResolvedValue({
    id: "draft_1",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
});

describe("saveInterviewDraft N9 provenance", () => {
  it("persists schemaVersion + generator provenance when creating a draft", async () => {
    const result = await saveInterviewDraft({
      ...baseInput(),
      generatorProvider: "openai_responses",
      generatorModel: "gpt-test",
    });

    expect(result.ok).toBe(true);
    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.schemaVersion).toBe(INTERVIEW_PLAN_SCHEMA_VERSION);
    expect(createCall?.data.generatorProvider).toBe("openai_responses");
    expect(createCall?.data.generatorModel).toBe("gpt-test");
  });

  it("records the deterministic provider when AI tailoring fell back", async () => {
    await saveInterviewDraft({
      ...baseInput(),
      generatorProvider: "deterministic",
      generatorModel: "interview-draft-v1",
    });

    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.generatorProvider).toBe("deterministic");
    expect(createCall?.data.generatorModel).toBe("interview-draft-v1");
  });

  it("still stamps schemaVersion when no provenance is supplied (manual edits)", async () => {
    await saveInterviewDraft(baseInput());

    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.schemaVersion).toBe(INTERVIEW_PLAN_SCHEMA_VERSION);
    expect(createCall?.data.generatorProvider ?? null).toBeNull();
    expect(createCall?.data.generatorModel ?? null).toBeNull();
  });
});
