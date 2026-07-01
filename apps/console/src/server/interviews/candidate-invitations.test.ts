import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback) => callback(prismaMock)),
  candidateInvitation: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  interview: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

vi.mock("server-only", () => ({}));

import {
  buildCandidateInvitationPath,
  createCandidateInvitationForInterview,
  expireStaleCandidateInvitations,
  reissueCandidateInvitation,
  toCandidateInvitationSummary,
} from "./candidate-invitations";

const now = new Date("2026-07-01T10:00:00.000Z");

function publishedInterview(overrides: Record<string, unknown> = {}) {
  return {
    id: "interview_123",
    jobId: "job_123",
    organizationId: "org_123",
    status: "published",
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    candidateEmail: "ada@example.com",
    candidateName: "Ada Martin",
    consentedAt: null,
    createdAt: now,
    expiresAt: new Date("2026-07-31T10:00:00.000Z"),
    id: "cinv_123",
    openedAt: null,
    status: "invited",
    token: "ci_public",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  prismaMock.interview.findFirst.mockResolvedValue(publishedInterview());
  prismaMock.candidateInvitation.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) =>
      invitation({
        candidateEmail: data.candidateEmail,
        candidateName: data.candidateName,
        expiresAt: data.expiresAt,
        status: data.status,
        token: data.token,
      }),
  );
  prismaMock.candidateInvitation.findFirst.mockResolvedValue(null);
  prismaMock.candidateInvitation.findUnique.mockResolvedValue(null);
  prismaMock.candidateInvitation.update.mockResolvedValue({});
  prismaMock.candidateInvitation.updateMany.mockResolvedValue({ count: 0 });
});

describe("candidate invitations", () => {
  it("creates an organization-scoped ci link for a published interview", async () => {
    const result = await createCandidateInvitationForInterview({
      actorRole: "recruiter",
      candidateEmail: " ADA@Example.COM ",
      candidateName: " Ada Martin ",
      interviewId: "interview_123",
      organizationId: "org_123",
    });

    expect(result).toMatchObject({
      ok: true,
      invitation: {
        candidateEmail: "ada@example.com",
        candidateLabel: "Ada Martin",
        candidateName: "Ada Martin",
        candidatePath: expect.stringMatching(/^\/interview\/ci_/),
        status: "invited",
      },
    });
    expect(prismaMock.interview.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
        jobId: true,
        organizationId: true,
        status: true,
      },
      where: {
        id: "interview_123",
        organizationId: "org_123",
      },
    });
    expect(prismaMock.candidateInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        candidateEmail: "ada@example.com",
        candidateName: "Ada Martin",
        interviewId: "interview_123",
        jobId: "job_123",
        organizationId: "org_123",
        status: "invited",
        token: expect.stringMatching(/^ci_/),
      }),
    });
  });

  it("keeps email optional for manual copy-link delivery", async () => {
    const result = await createCandidateInvitationForInterview({
      actorRole: "owner",
      candidateName: "Manual Candidate",
      interviewId: "interview_123",
      organizationId: "org_123",
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.candidateInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        candidateEmail: null,
        candidateName: "Manual Candidate",
      }),
    });
  });

  it("rejects viewer invite attempts before persistence", async () => {
    const result = await createCandidateInvitationForInterview({
      actorRole: "viewer",
      candidateEmail: "ada@example.com",
      interviewId: "interview_123",
      organizationId: "org_123",
    });

    expect(result).toEqual({
      error: "Viewer role cannot invite candidates.",
      ok: false,
    });
    expect(prismaMock.interview.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.candidateInvitation.create).not.toHaveBeenCalled();
  });

  it("rejects interviews outside the active organization", async () => {
    prismaMock.interview.findFirst.mockResolvedValueOnce(null);

    const result = await createCandidateInvitationForInterview({
      actorRole: "admin",
      candidateEmail: "ada@example.com",
      interviewId: "interview_other",
      organizationId: "org_123",
    });

    expect(result).toEqual({
      error: "Published role screen was not found for this workspace.",
      ok: false,
    });
    expect(prismaMock.candidateInvitation.create).not.toHaveBeenCalled();
  });

  it("does not invite candidates for paused interviews", async () => {
    prismaMock.interview.findFirst.mockResolvedValueOnce(
      publishedInterview({ status: "paused" }),
    );

    const result = await createCandidateInvitationForInterview({
      actorRole: "admin",
      candidateEmail: "ada@example.com",
      interviewId: "interview_123",
      organizationId: "org_123",
    });

    expect(result).toEqual({
      error: "Publish this role screen before inviting candidates.",
      ok: false,
    });
    expect(prismaMock.candidateInvitation.create).not.toHaveBeenCalled();
  });

  it("reissues an expired invitation by creating a new auditable link", async () => {
    prismaMock.candidateInvitation.findFirst.mockResolvedValueOnce({
      ...invitation({ status: "expired" }),
      interview: publishedInterview(),
    });

    const result = await reissueCandidateInvitation({
      actorRole: "recruiter",
      invitationId: "cinv_123",
      organizationId: "org_123",
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.candidateInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        candidateEmail: "ada@example.com",
        candidateName: "Ada Martin",
        interviewId: "interview_123",
        status: "invited",
        token: expect.stringMatching(/^ci_/),
      }),
    });
    expect(prismaMock.candidateInvitation.update).not.toHaveBeenCalled();
  });

  it("supersedes a failed invitation before reissuing", async () => {
    prismaMock.candidateInvitation.findFirst.mockResolvedValueOnce({
      ...invitation({ status: "failed" }),
      interview: publishedInterview(),
    });

    const result = await reissueCandidateInvitation({
      actorRole: "admin",
      invitationId: "cinv_123",
      organizationId: "org_123",
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.candidateInvitation.update).toHaveBeenCalledWith({
      data: { status: "superseded" },
      where: { id: "cinv_123" },
    });
    expect(prismaMock.candidateInvitation.create).toHaveBeenCalledTimes(1);
  });

  it("keeps completed invitations immutable", async () => {
    prismaMock.candidateInvitation.findFirst.mockResolvedValueOnce({
      ...invitation({ status: "completed" }),
      interview: publishedInterview(),
    });

    const result = await reissueCandidateInvitation({
      actorRole: "owner",
      invitationId: "cinv_123",
      organizationId: "org_123",
    });

    expect(result).toEqual({
      error: "Completed or superseded invitations cannot be reissued.",
      ok: false,
    });
    expect(prismaMock.candidateInvitation.update).not.toHaveBeenCalled();
    expect(prismaMock.candidateInvitation.create).not.toHaveBeenCalled();
  });

  it("marks stale invitations expired in the current organization", async () => {
    await expireStaleCandidateInvitations({
      interviewId: "interview_123",
      organizationId: "org_123",
    });

    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { status: "expired" },
      where: {
        expiresAt: { lte: now },
        interviewId: "interview_123",
        organizationId: "org_123",
        status: {
          notIn: ["completed", "expired", "superseded"],
        },
      },
    });
  });

  it("resolves expired display state without relying on persisted status", () => {
    expect(
      toCandidateInvitationSummary(
        invitation({
          expiresAt: new Date("2026-06-30T10:00:00.000Z"),
          status: "invited",
        }),
        now,
      ),
    ).toMatchObject({
      status: "expired",
    });
  });

  it("builds the public copy-link path from the invitation token", () => {
    expect(buildCandidateInvitationPath("ci_test")).toBe("/interview/ci_test");
  });
});
