import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateInvitation: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  candidateSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  interview: {
    findUnique: vi.fn(),
  },
  liveInterviewEvent: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  liveInterviewSession: {
    upsert: vi.fn(),
  },
}));

const reserveCreditForSession = vi.hoisted(() => vi.fn());
const getWorkspaceBilling = vi.hoisted(() => vi.fn());
// The settlement rule itself is covered in `credit-settlement.test.ts`; what
// these tests pin is that every terminal write reaches it, with the kind of the
// status it just wrote.
const settleCandidateSessionCredit = vi.hoisted(() => vi.fn());
const notifyCandidateInterviewCompleted = vi.hoisted(() => vi.fn());

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prelude/billing")>()),
  reserveCreditForSession,
}));
vi.mock("@prelude/billing/server", () => ({ getWorkspaceBilling }));
vi.mock("@prelude/notifications", () => ({
  createNotificationDispatcher: () => ({ notifyCandidateInterviewCompleted }),
}));
vi.mock("./credit-settlement", () => ({ settleCandidateSessionCredit }));

import { unconfiguredBilling } from "@prelude/billing";

import {
  completeCandidateSession,
  markCandidateSessionLifecycle,
  prepareCandidateSession,
  submitCandidateFormInterview,
} from "./public-interviews";

const now = new Date("2026-08-14T09:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
  prismaMock.candidateInvitation.findUnique.mockResolvedValue(
    openedInvitation(),
  );
  prismaMock.candidateInvitation.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.candidateSession.findFirst.mockResolvedValue(resumableSession());
  prismaMock.candidateSession.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "cs_1",
      resumeToken: "cs_resume",
      ...data,
    }),
  );
  reserveCreditForSession.mockResolvedValue({ ok: true, reservationId: "res_1" });
  getWorkspaceBilling.mockResolvedValue(unconfiguredBilling(now));
  notifyCandidateInterviewCompleted.mockResolvedValue(undefined);
  settleCandidateSessionCredit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("prepareCandidateSession resume", () => {
  it("resumes against the existing hold without taking a second credit", async () => {
    const result = await prepareCandidateSession(resumeAttempt());

    expect(result).toMatchObject({ ok: true, candidateId: "cs_1" });
    expect(reserveCreditForSession).toHaveBeenCalledWith(prismaMock, {
      organizationId: "org_1",
      candidateSessionId: "cs_1",
      now,
    });
    expect(reserveCreditForSession).toHaveBeenCalledTimes(1);
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "starting" }),
      where: { id: "cs_1" },
    });
  });

  it("refuses a resume the wallet can no longer cover", async () => {
    reserveCreditForSession.mockResolvedValue({
      ok: false,
      error: "no_credits_available",
    });

    const result = await prepareCandidateSession(resumeAttempt());

    expect(result).toEqual({
      error: "candidate_interview_limit_reached",
      ok: false,
      status: 402,
    });
    expect(prismaMock.candidateSession.update).not.toHaveBeenCalled();
  });

  it("leaves the resume unmetered when credit billing is off", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "");

    const result = await prepareCandidateSession(resumeAttempt());

    expect(result).toMatchObject({ ok: true });
    expect(reserveCreditForSession).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.update).toHaveBeenCalledTimes(1);
  });
});

describe("terminal writes settle their credit", () => {
  beforeEach(() => {
    prismaMock.candidateSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.candidateSession.findFirst.mockResolvedValue({
      candidateInvitationId: null,
    });
  });

  it("settles a completion", async () => {
    await expect(
      completeCandidateSession({ resumeToken: "cs_resume", sessionId: "cs_1" }),
    ).resolves.toEqual({ ok: true });

    expect(settleCandidateSessionCredit).toHaveBeenCalledWith(prismaMock, {
      kind: "completed",
      now,
      sessionId: "cs_1",
    });
  });

  it("settles an abandon with the status it just wrote", async () => {
    await expect(
      markCandidateSessionLifecycle({
        action: "abandon",
        resumeToken: "cs_resume",
        sessionId: "cs_1",
      }),
    ).resolves.toEqual({ ok: true, status: "abandoned" });

    expect(settleCandidateSessionCredit).toHaveBeenCalledWith(prismaMock, {
      kind: "abandoned",
      now,
      sessionId: "cs_1",
    });
  });

  it("settles the attempt a written submission supersedes", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ responseModes: ["audio", "text"] }),
    );
    prismaMock.candidateSession.findFirst
      .mockResolvedValueOnce({ ...resumableSession(), status: "failed" })
      .mockResolvedValueOnce({ candidateInvitationId: null });
    prismaMock.candidateSession.create.mockResolvedValue({
      id: "cs_retry",
      interviewId: "interview_1",
      resumeToken: "cs_retry_resume",
    });
    prismaMock.interview.findUnique.mockResolvedValue({
      questions: [{ id: "q1", prompt: "Describe a production incident." }],
    });

    const result = await submitCandidateFormInterview({
      answers: [{ questionId: "q1", text: "I paged, bisected, then rolled back." }],
      candidateToken: "tok_candidate",
      consentAccepted: true,
      resumeToken: "cs_resume",
    });

    expect(result).toMatchObject({ ok: true, productSessionId: "cs_retry" });
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: { status: "superseded" },
      where: { id: "cs_1" },
    });
    expect(settleCandidateSessionCredit).toHaveBeenCalledWith(prismaMock, {
      kind: "superseded",
      now,
      sessionId: "cs_1",
    });
  });
});

function resumeAttempt() {
  return {
    candidateToken: "tok_candidate",
    consentAccepted: true,
    resumeToken: "cs_resume",
  };
}

function resumableSession() {
  return {
    id: "cs_1",
    // The resume lookup selects the whole row; settlement and the resume
    // reservation both read the organization from it rather than from the
    // interview the candidate arrived through.
    organizationId: "org_1",
    resumeToken: "cs_resume",
    startedAt: new Date("2026-08-14T08:50:00.000Z"),
    status: "in_progress",
  };
}

function openedInvitation({
  responseModes = ["audio"],
}: { responseModes?: string[] } = {}) {
  return {
    candidateEmail: "ada@example.com",
    candidateName: "Ada",
    expiresAt: new Date("2026-08-20T09:00:00.000Z"),
    id: "inv_1",
    interview: {
      estimatedMinutes: 10,
      id: "interview_1",
      job: { title: "Backend Engineer" },
      jobId: "job_1",
      organization: { name: "Acme" },
      organizationId: "org_1",
      publicToken: "pub_1",
      questions: [{ id: "q1", prompt: "Describe a production incident." }],
      responseModes,
      roleTitle: "Backend Engineer",
      status: "published",
    },
    openedAt: new Date("2026-08-14T08:45:00.000Z"),
    status: "in_progress",
    token: "tok_candidate",
  };
}
