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
  organization: {
    findUniqueOrThrow: vi.fn(),
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
    role: "recruiter",
    userId: "user_123",
  })),
}));

const contentLanguages = vi.hoisted(() => ({
  interviewDefault: "en" as "en" | "fr",
  workspace: "en" as "en" | "fr",
}));

// The org-settings read rides the same transaction now, so the sync reader is
// what the save path calls; the settings blob itself is irrelevant here because
// this mock stands in for parsing it.
vi.mock("../organizations/organization-content-languages", () => ({
  readOrganizationContentLanguages: vi.fn(() => contentLanguages),
}));

import { getCompletedOrganizationScope } from "../organizations/organization-scope";
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
  contentLanguages.interviewDefault = "en";
  contentLanguages.workspace = "en";
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
  tx.organization.findUniqueOrThrow.mockResolvedValue({ settings: {} });
});

describe("saveInterviewDraft N9 provenance", () => {
  it("rejects viewers before creating or updating a role", async () => {
    vi.mocked(getCompletedOrganizationScope).mockResolvedValueOnce({
      organizationId: "org_123",
      role: "viewer",
      userId: "user_viewer",
    } as never);

    const result = await saveInterviewDraft(baseInput());

    expect(result).toMatchObject({ ok: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(tx.job.create).not.toHaveBeenCalled();
    expect(tx.interviewDraft.create).not.toHaveBeenCalled();
  });

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

// Plan 2026-08-18, rules 1 + 6: the interview language is a per-DRAFT fact,
// stamped once at creation from the workspace's interview default. It is never
// re-derived on a later save — only the builder's explicit selector may change
// it — so an autosave can't silently rewrite the language the questions and
// criteria were actually generated in.
describe("saveInterviewDraft interview language stamping", () => {
  it("stamps the workspace interview default when creating a draft", async () => {
    contentLanguages.interviewDefault = "fr";

    await saveInterviewDraft(baseInput());

    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.language).toBe("fr");
  });

  it("prefers the recruiter's explicit selection over the workspace default", async () => {
    contentLanguages.interviewDefault = "en";

    await saveInterviewDraft({ ...baseInput(), language: "fr" });

    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.language).toBe("fr");
  });

  it("falls back to English for an unusable stored default", async () => {
    contentLanguages.interviewDefault = "de" as unknown as "en";

    await saveInterviewDraft(baseInput());

    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.language).toBe("en");
  });

  it("leaves an existing draft's language untouched on a plain save", async () => {
    tx.interviewDraft.findFirst.mockResolvedValueOnce({ id: "draft_1" });
    contentLanguages.interviewDefault = "fr";

    await saveInterviewDraft({ ...baseInput(), draftId: "draft_1" });

    const updateCall = tx.interviewDraft.update.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(updateCall?.data).not.toHaveProperty("language");
  });

  it("re-stamps an existing draft only through the explicit selector", async () => {
    tx.interviewDraft.findFirst.mockResolvedValueOnce({ id: "draft_1" });

    await saveInterviewDraft({
      ...baseInput(),
      draftId: "draft_1",
      language: "fr",
    });

    const updateCall = tx.interviewDraft.update.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(updateCall?.data.language).toBe("fr");
  });

  it("ignores a language outside the catalogue on update", async () => {
    tx.interviewDraft.findFirst.mockResolvedValueOnce({ id: "draft_1" });

    await saveInterviewDraft({
      ...baseInput(),
      draftId: "draft_1",
      language: "de" as unknown as "fr",
    });

    const updateCall = tx.interviewDraft.update.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(updateCall?.data).not.toHaveProperty("language");
  });
});

// N14 — role location is a Job attribute (where the job is), threaded from the
// brief form into Job.location on both create and update. Optional/nullable.
describe("N14 saveInterviewDraft location", () => {
  it("writes the trimmed location to Job.location when creating a job", async () => {
    const result = await saveInterviewDraft({
      ...baseInput(),
      location: "  Paris, France  ",
    });

    expect(result.ok).toBe(true);
    const createCall = tx.job.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(createCall?.data.location).toBe("Paris, France");
  });

  it("updates Job.location when an existing job is re-saved", async () => {
    tx.job.findFirst.mockResolvedValue({ id: "job_1" });

    await saveInterviewDraft({
      ...baseInput(),
      jobId: "job_1",
      location: "Remote",
    });

    const updateCall = tx.job.update.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;

    expect(updateCall?.data.location).toBe("Remote");
    expect(tx.job.create).not.toHaveBeenCalled();
  });

  it("collapses a blank or missing location to null", async () => {
    await saveInterviewDraft({ ...baseInput(), location: "   " });

    const blankCall = tx.job.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(blankCall?.data.location).toBeNull();

    vi.clearAllMocks();
    tx.job.findFirst.mockResolvedValue(null);
    tx.job.create.mockResolvedValue({ id: "job_1" });
    tx.interviewDraft.findFirst.mockResolvedValue(null);
    tx.interviewDraft.create.mockResolvedValue({
      id: "draft_1",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await saveInterviewDraft(baseInput());

    const missingCall = tx.job.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(missingCall?.data.location).toBeNull();
  });
});

// N10.C — the deferred N1 SAVE lock. saveInterviewDraft must hard-fail and write
// nothing when any question or criterion references a disallowed/protected topic.
describe("N10 saveInterviewDraft compliance gate", () => {
  it("rejects and persists nothing when a question references a protected topic", async () => {
    const result = await saveInterviewDraft({
      ...baseInput(),
      questions: [
        {
          category: "custom",
          durationSeconds: 75,
          expectedSignal: "Age",
          id: "q1",
          maxFollowups: 1,
          prompt: "How old are you, and when did you graduate?",
          required: true,
          source: "agent",
        },
        baseInput().questions[1]!,
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("protected or disallowed topics");
    }
    // The compliance gate runs before any write.
    expect(tx.interviewDraft.create).not.toHaveBeenCalled();
    expect(tx.interviewDraft.update).not.toHaveBeenCalled();
    expect(tx.job.create).not.toHaveBeenCalled();
    expect(tx.job.update).not.toHaveBeenCalled();
  });

  it("rejects and persists nothing when a question follow-up references a protected topic", async () => {
    const input = baseInput();
    const result = await saveInterviewDraft({
      ...input,
      questions: [
        {
          ...input.questions[0]!,
          followUpPrompt: "And what is your date of birth?",
        },
        input.questions[1]!,
      ],
    });

    expect(result.ok).toBe(false);
    expect(tx.interviewDraft.create).not.toHaveBeenCalled();
    expect(tx.interviewDraft.update).not.toHaveBeenCalled();
  });

  it("rejects and persists nothing when a criterion references a protected topic", async () => {
    const result = await saveInterviewDraft({
      ...baseInput(),
      criteria: [
        {
          id: "c1",
          label: "Maternity leave plans",
          description: "Whether the candidate is planning maternity leave soon.",
        },
        ...baseInput().criteria.slice(1),
      ],
    });

    expect(result.ok).toBe(false);
    expect(tx.interviewDraft.create).not.toHaveBeenCalled();
    expect(tx.interviewDraft.update).not.toHaveBeenCalled();
  });

  it("saves normally for a clean, job-related plan (gate is not over-blocking)", async () => {
    const result = await saveInterviewDraft(baseInput());

    expect(result.ok).toBe(true);
    expect(tx.interviewDraft.create).toHaveBeenCalledTimes(1);
  });

  it("persists the recruiter-authored follow-up prompt", async () => {
    const followUp =
      "What did you personally decide, and what changed afterward?";
    const input = baseInput();
    const result = await saveInterviewDraft({
      ...input,
      questions: [
        { ...input.questions[0]!, followUpPrompt: followUp },
        input.questions[1]!,
      ],
    });

    expect(result.ok).toBe(true);
    const createCall = tx.interviewDraft.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(JSON.stringify(createCall?.data)).toContain(followUp);
  });
});
