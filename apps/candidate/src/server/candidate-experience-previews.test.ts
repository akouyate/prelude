import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateExperiencePreview: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));

import {
  getCandidateExperiencePreviewContext,
  prepareCandidateExperiencePreviewSession,
  releaseCandidateExperiencePreviewReservation,
} from "./candidate-experience-previews";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-03T10:00:00.000Z"));
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  prismaMock.candidateExperiencePreview.findUnique.mockResolvedValue(
    activePreview(),
  );
  prismaMock.candidateExperiencePreview.updateMany.mockResolvedValue({
    count: 1,
  });
});

describe("candidate experience preview", () => {
  it("loads the immutable display snapshot without candidate lifecycle writes", async () => {
    const context = await getCandidateExperiencePreviewContext("pvtk_secret");

    expect(context).toMatchObject({
      kind: "preview",
      interview: {
        companyName: "Acme",
        jobTitle: "Backend Engineer",
        responseModes: ["audio", "form"],
      },
    });
    expect(
      prismaMock.candidateExperiencePreview.findUnique,
    ).toHaveBeenCalledWith({
      where: { tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(
      prismaMock.candidateExperiencePreview.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("fails closed for an expired preview", async () => {
    prismaMock.candidateExperiencePreview.findUnique.mockResolvedValueOnce({
      ...activePreview(),
      expiresAt: new Date("2026-08-03T09:59:59.000Z"),
    });

    await expect(
      getCandidateExperiencePreviewContext("pvtk_secret"),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("atomically reserves an isolated live test without creating product data", async () => {
    const result = await prepareCandidateExperiencePreviewSession({
      consentAccepted: true,
      previewToken: "pvtk_secret",
    });

    expect(result).toMatchObject({
      allowedModalities: ["audio"],
      candidateId: expect.stringMatching(/^preview_/),
      interviewPlanId: "pv_1",
      ok: true,
      reservation: {
        previousLiveTestCount: 0,
        previousRuntimeExpiresAt: null,
        previewId: "pv_1",
        runtimeExpiresAt: new Date("2026-08-03T10:45:00.000Z"),
      },
    });
    expect(
      prismaMock.candidateExperiencePreview.updateMany,
    ).toHaveBeenCalledWith({
      data: {
        liveTestCount: { increment: 1 },
        runtimeExpiresAt: new Date("2026-08-03T10:45:00.000Z"),
      },
      where: expect.objectContaining({
        id: "pv_1",
        liveTestCount: 0,
        revokedAt: null,
        runtimeExpiresAt: null,
      }),
    });
  });

  it("releases a failed realtime reservation without overwriting a newer attempt", async () => {
    await releaseCandidateExperiencePreviewReservation({
      previousLiveTestCount: 1,
      previousRuntimeExpiresAt: new Date("2026-08-03T10:30:00.000Z"),
      previewId: "pv_1",
      runtimeExpiresAt: new Date("2026-08-03T10:45:00.000Z"),
    });

    expect(
      prismaMock.candidateExperiencePreview.updateMany,
    ).toHaveBeenCalledWith({
      data: {
        liveTestCount: 1,
        runtimeExpiresAt: new Date("2026-08-03T10:30:00.000Z"),
      },
      where: {
        id: "pv_1",
        liveTestCount: 2,
        runtimeExpiresAt: new Date("2026-08-03T10:45:00.000Z"),
      },
    });
  });
});

function activePreview() {
  return {
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
    createdByUserId: "user_1",
    draftId: "draft_1",
    expiresAt: new Date("2026-08-03T10:30:00.000Z"),
    id: "pv_1",
    liveTestCount: 0,
    organizationId: "org_1",
    revokedAt: null,
    runtimeExpiresAt: null,
    schemaVersion: 1,
    snapshot: {
      companyName: "Acme",
      jobId: "job_1",
      jobTitle: "Backend Engineer",
      plan: {
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
        questions: [
          {
            category: "experience",
            id: "question_1",
            prompt:
              "Describe a production incident you investigated end to end.",
          },
        ],
        rationale: "Focused first screen.",
        responseModes: ["audio", "text"],
        roleBrief: "Own backend services and incident response.",
        roleTitle: "Backend Engineer",
        schemaVersion: 1,
        seniority: "mid",
      },
      schemaVersion: 1,
    },
    tokenDigest: "digest",
  };
}
