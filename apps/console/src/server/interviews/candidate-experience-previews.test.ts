import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  candidateExperiencePreview: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  interviewDraft: {
    findFirst: vi.fn(),
  },
  liveInterviewSession: {
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((operation: (client: typeof tx) => unknown) =>
    operation(tx),
  ),
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("server-only", () => ({}));
vi.mock("../organizations/organization-scope", () => ({
  getCompletedOrganizationScope: vi.fn(async () => ({
    organizationId: "org_1",
    role: "recruiter",
    userId: "user_1",
  })),
}));

import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { createCandidateExperiencePreview } from "./candidate-experience-previews";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-03T10:00:00.000Z"));
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "https://candidate.hirecall.test");
  tx.candidateExperiencePreview.findMany.mockResolvedValue([]);
  tx.liveInterviewSession.findMany.mockResolvedValue([]);
  tx.candidateExperiencePreview.create.mockImplementation(({ data }) =>
    Promise.resolve(data),
  );
  tx.interviewDraft.findFirst.mockResolvedValue(interviewDraft());
});

describe("createCandidateExperiencePreview", () => {
  it("creates an immutable, short-lived snapshot and returns only the raw URL token", async () => {
    const result = await createCandidateExperiencePreview("draft_1");

    expect(result).toMatchObject({
      ok: true,
      expiresAt: "2026-08-03T10:30:00.000Z",
    });
    if (!result.ok) {
      throw new Error("expected a preview");
    }

    const rawToken = new URL(result.previewUrl).pathname.split("/").at(-1);
    expect(rawToken).toMatch(/^pvtk_[A-Za-z0-9_-]+$/);
    expect(result.previewUrl).toMatch(
      /^https:\/\/candidate\.hirecall\.test\/preview\/pvtk_/,
    );

    const createCall = tx.candidateExperiencePreview.create.mock.calls[0]?.[0];
    expect(createCall.data).toMatchObject({
      createdByUserId: "user_1",
      draftId: "draft_1",
      expiresAt: new Date("2026-08-03T10:30:00.000Z"),
      liveTestCount: 0,
      organizationId: "org_1",
      runtimeExpiresAt: null,
      snapshot: expect.objectContaining({
        companyName: "Acme",
        jobId: "job_1",
        jobTitle: "Backend Engineer",
        plan: expect.objectContaining({ roleTitle: "Backend Engineer" }),
      }),
      tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(createCall.data.tokenDigest).not.toContain(rawToken);
  });

  // GL-T4.2 — the preview snapshot is the only plan payload the Go store reads
  // for a `pv_` session, so the interview language must ride along with it.
  it("carries the draft language into the preview snapshot plan", async () => {
    tx.interviewDraft.findFirst.mockResolvedValueOnce({
      ...interviewDraft(),
      language: "fr",
    });

    const result = await createCandidateExperiencePreview("draft_1");

    expect(result.ok).toBe(true);
    const snapshot = tx.candidateExperiencePreview.create.mock.calls[0]?.[0]
      .data.snapshot as { plan: { language: string | null } };
    expect(snapshot.plan.language).toBe("fr");
  });

  it("passes a legacy null draft language through honestly", async () => {
    tx.interviewDraft.findFirst.mockResolvedValueOnce({
      ...interviewDraft(),
      language: null,
    });

    const result = await createCandidateExperiencePreview("draft_1");

    expect(result.ok).toBe(true);
    const snapshot = tx.candidateExperiencePreview.create.mock.calls[0]?.[0]
      .data.snapshot as { plan: { language: string | null } };
    // Never resolved at write time: the live pipeline's own fallback decides
    // what a legacy plan is spoken in (plan 2026-08-18, rules 6 + 7).
    expect(snapshot.plan.language).toBeNull();
  });

  it("rejects workspace members who cannot manage roles", async () => {
    vi.mocked(getCompletedOrganizationScope).mockResolvedValueOnce({
      organizationId: "org_1",
      role: "viewer",
      userId: "user_viewer",
    } as never);

    await expect(createCandidateExperiencePreview("draft_1")).resolves.toEqual({
      error: "You do not have permission to preview this role.",
      ok: false,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses plaintext preview URLs in production before persistence", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CANDIDATE_URL", "http://candidate.hirecall.test");

    await expect(createCandidateExperiencePreview("draft_1")).rejects.toThrow(
      "NEXT_PUBLIC_CANDIDATE_URL must use HTTPS in production.",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("deletes only expired preview runtime data during bounded cleanup", async () => {
    tx.candidateExperiencePreview.findMany.mockResolvedValueOnce([
      { id: "pv_expired" },
    ]);

    await createCandidateExperiencePreview("draft_1");

    expect(tx.liveInterviewSession.deleteMany).toHaveBeenCalledWith({
      where: {
        interviewPlanId: { in: ["pv_expired"] },
        kind: "preview",
      },
    });
    expect(tx.candidateExperiencePreview.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["pv_expired"] } },
    });
  });

  /*
   * The recording foreign key is ON DELETE RESTRICT (a recording row is the only
   * handle on an R2 audio object, so cascading it away orphans the audio). This
   * cleanup deletes live interview sessions, and it runs INSIDE the transaction
   * that creates a preview — so a session Postgres refuses to delete would not
   * just skip a row, it would fail the recruiter's preview creation with a
   * foreign-key error.
   *
   * Preview sessions are never recorded, so this should be unreachable; the guard
   * is what keeps it unreachable in consequence as well as in intent.
   */
  it("leaves a preview alone when its session still holds a recording", async () => {
    tx.candidateExperiencePreview.findMany.mockResolvedValueOnce([
      { id: "pv_expired" },
      { id: "pv_recorded" },
    ]);
    tx.liveInterviewSession.findMany.mockResolvedValueOnce([
      { interviewPlanId: "pv_recorded" },
    ]);

    await createCandidateExperiencePreview("draft_1");

    // The session delete never even offers the blocked id to Postgres...
    expect(tx.liveInterviewSession.deleteMany).toHaveBeenCalledWith({
      where: {
        interviewPlanId: { in: ["pv_expired"] },
        kind: "preview",
      },
    });
    // ...and its snapshot is kept too, so the session it belongs to stays
    // resolvable while its audio is still out there.
    expect(tx.candidateExperiencePreview.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["pv_expired"] } },
    });
  });

  it("skips both deletes when every expired preview still holds a recording", async () => {
    tx.candidateExperiencePreview.findMany.mockResolvedValueOnce([
      { id: "pv_recorded" },
    ]);
    tx.liveInterviewSession.findMany.mockResolvedValueOnce([
      { interviewPlanId: "pv_recorded" },
    ]);

    await createCandidateExperiencePreview("draft_1");

    expect(tx.liveInterviewSession.deleteMany).not.toHaveBeenCalled();
    expect(tx.candidateExperiencePreview.deleteMany).not.toHaveBeenCalled();
  });
});

function interviewDraft() {
  return {
    criteria: [
      {
        description: "Explains a concrete production investigation.",
        id: "criterion_1",
        label: "Problem solving",
      },
    ],
    estimatedMinutes: 8,
    focus: ["role_skills"],
    guardrails: [],
    id: "draft_1",
    job: { id: "job_1", title: "Backend Engineer" },
    jobId: "job_1",
    organization: { name: "Acme" },
    organizationId: "org_1",
    questions: [
      {
        category: "experience",
        id: "question_1",
        prompt: "Describe a production incident you investigated end to end.",
      },
    ],
    rationale: "Focused first screen.",
    responseModes: ["audio"],
    roleBrief: "Own backend services and incident response.",
    roleTitle: "Backend Engineer",
    schemaVersion: 1,
    seniority: "mid",
  };
}
