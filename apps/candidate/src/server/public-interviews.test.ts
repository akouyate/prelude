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
import { candidateConsentCopyFor } from "@prelude/core";

import {
  completeCandidateSession,
  getPublicInterviewContext,
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
  reserveCreditForSession.mockResolvedValue({
    ok: true,
    reservationId: "res_1",
  });
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
      answers: [
        { questionId: "q1", text: "I paged, bisected, then rolled back." },
      ],
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
  language = "en",
  responseModes = ["audio"],
}: { language?: string | null; responseModes?: string[] } = {}) {
  return {
    candidateEmail: "ada@example.com",
    candidateName: "Ada",
    expiresAt: new Date("2026-08-20T09:00:00.000Z"),
    id: "inv_1",
    interview: {
      estimatedMinutes: 10,
      id: "interview_1",
      language,
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

/** The row as it stands before anyone has followed the link. */
function invitedInvitation() {
  return {
    ...openedInvitation(),
    openedAt: null,
    status: "invited",
  };
}

describe("resolving the interview link is what records the open", () => {
  it("stamps invited → opened the first time the link resolves", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      invitedInvitation(),
    );

    const context = await getPublicInterviewContext("tok_candidate");

    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { openedAt: now, status: "opened" },
      where: { id: "inv_1" },
    });
    expect(context).toMatchObject({ kind: "published" });
  });

  it("stamps the open once, never re-stamping a later visit", async () => {
    // `openedAt` is the first-touch evidence the recruiter reads as a date; a
    // second visit must not move it.
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation(),
    );

    await getPublicInterviewContext("tok_candidate");

    expect(prismaMock.candidateInvitation.updateMany).not.toHaveBeenCalled();
  });

  it("never downgrades a terminal invitation to opened", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...invitedInvitation(),
      status: "completed",
    });

    await getPublicInterviewContext("tok_candidate");

    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { openedAt: now, status: "completed" },
      where: { id: "inv_1" },
    });
  });

  it("flips a lapsed invitation to expired instead of opening it", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...invitedInvitation(),
      expiresAt: new Date("2026-08-13T09:00:00.000Z"),
    });

    const context = await getPublicInterviewContext("tok_candidate");

    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { status: "expired" },
      where: {
        id: "inv_1",
        status: { notIn: ["completed", "expired", "superseded"] },
      },
    });
    expect(context).toMatchObject({ invitation: { status: "expired" } });
  });
});

describe("the privacy notice resolves the same link without touching it", () => {
  // `/interview/<token>/privacy` is a second URL on the same token, and a more
  // casually fetched one: email scanners and link-preview bots reach it with no
  // candidate behind them. Resolving it must never be what tells the recruiter
  // "the candidate opened it", so this path takes no write at all.
  it("stamps no open on an invitation nobody has followed yet", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      invitedInvitation(),
    );

    const context = await getPublicInterviewContext("tok_candidate", {
      recordVisit: false,
    });

    expect(prismaMock.candidateInvitation.updateMany).not.toHaveBeenCalled();
    expect(context).toMatchObject({
      interview: { companyName: "Acme" },
      invitation: { status: "invited" },
      kind: "published",
    });
  });

  it("leaves a lapsed invitation alone, and still reads it as expired", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...invitedInvitation(),
      expiresAt: new Date("2026-08-13T09:00:00.000Z"),
    });

    const context = await getPublicInterviewContext("tok_candidate", {
      recordVisit: false,
    });

    expect(prismaMock.candidateInvitation.updateMany).not.toHaveBeenCalled();
    expect(context).toMatchObject({
      invitation: { status: "expired" },
      kind: "published",
    });
  });

  it("leaves a terminal invitation exactly as it found it", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...invitedInvitation(),
      status: "completed",
    });

    const context = await getPublicInterviewContext("tok_candidate", {
      recordVisit: false,
    });

    expect(prismaMock.candidateInvitation.updateMany).not.toHaveBeenCalled();
    expect(context).toMatchObject({
      invitation: { status: "completed" },
      kind: "published",
    });
  });
});

describe("the rendering language reaches the candidate surfaces", () => {
  it("resolves the published interview's stamped language", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "FR" }),
    );

    const context = await getPublicInterviewContext("tok_candidate");

    expect(context).toMatchObject({
      interview: { language: "fr" },
      kind: "published",
    });
  });

  it("falls back to French for an interview published before stamping existed", async () => {
    // Same fallback as the Go realtime store: those interviews are conducted in
    // French, so the consent the candidate reads has to be French too.
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: null }),
    );

    const context = await getPublicInterviewContext("tok_candidate");

    expect(context).toMatchObject({
      interview: { language: "fr" },
      kind: "published",
    });
  });
});

describe("consent language is recorded as evidence", () => {
  it("stamps the rendered language on a resumed session", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "fr" }),
    );

    await expect(
      prepareCandidateSession(resumeAttempt()),
    ).resolves.toMatchObject({ ok: true });

    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consentCopyVersion: "candidate-consent-v3-no-recording",
        consentLanguage: "fr",
      }),
      where: { id: "cs_1" },
    });
  });

  it("stamps the rendered language on a newly created session", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "en" }),
    );
    prismaMock.candidateSession.findFirst.mockResolvedValue(null);
    prismaMock.candidateSession.create.mockResolvedValue({
      id: "cs_new",
      interviewId: "interview_1",
      resumeToken: "cs_new_resume",
    });

    await expect(
      prepareCandidateSession({
        candidateToken: "tok_candidate",
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(prismaMock.candidateSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consentCopyVersion: "candidate-consent-v3-no-recording",
        consentLanguage: "en",
      }),
    });
  });

  it("stamps the rendered language on the invitation consent row", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "fr" }),
    );

    await expect(
      prepareCandidateSession(resumeAttempt()),
    ).resolves.toMatchObject({ ok: true });

    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consentCopyVersion: "candidate-consent-v3-no-recording",
        consentLanguage: "fr",
      }),
      where: {
        id: "inv_1",
        status: { notIn: ["completed", "expired", "superseded"] },
      },
    });
  });

  it("records the fallback language when the interview carries no stamp", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: null }),
    );

    await expect(
      prepareCandidateSession(resumeAttempt()),
    ).resolves.toMatchObject({ ok: true });

    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ consentLanguage: "fr" }),
      where: { id: "cs_1" },
    });
  });
});

describe("the recording reality reaches the candidate surfaces", () => {
  it("resolves the deployment's recording flag once, on the context", async () => {
    // Same invariant as `consentLanguage`: one server-side resolution feeds both
    // the copy the candidate reads and the version stamped on their session, so
    // the two can never describe different processing.
    vi.stubEnv("RECORDING_ENABLED", "1");

    await expect(
      getPublicInterviewContext("tok_candidate"),
    ).resolves.toMatchObject({
      interview: { recordingActive: true },
      kind: "published",
    });
  });

  it("reads an absent or unparseable flag as no recording", async () => {
    // Fail-closed: an environment we cannot read is one we cannot claim
    // recording from, so the candidate gets the no-recording truth.
    vi.stubEnv("RECORDING_ENABLED", "");

    await expect(
      getPublicInterviewContext("tok_candidate"),
    ).resolves.toMatchObject({
      interview: { recordingActive: false },
      kind: "published",
    });
  });
});

describe("the stamped consent version is the one that was rendered", () => {
  const writes = async () => {
    await expect(
      prepareCandidateSession(resumeAttempt()),
    ).resolves.toMatchObject({ ok: true });

    return {
      invitation:
        prismaMock.candidateInvitation.updateMany.mock.calls.at(-1)?.[0].data,
      session: prismaMock.candidateSession.update.mock.calls.at(-1)?.[0].data,
    };
  };

  it("stamps the no-recording variant where recording is off", async () => {
    vi.stubEnv("RECORDING_ENABLED", "0");
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "fr" }),
    );

    const { invitation, session } = await writes();
    const rendered = candidateConsentCopyFor("fr", false);

    expect(session).toMatchObject({
      consentCopyVersion: "candidate-consent-v3-no-recording",
      consentLanguage: "fr",
    });
    expect(invitation).toMatchObject({
      consentCopyVersion: "candidate-consent-v3-no-recording",
      consentLanguage: "fr",
    });
    // Not two constants that happen to agree: the stamp IS the version of the
    // text the pre-join screens rendered for this language and this flag.
    expect(session?.consentCopyVersion).toBe(rendered.version);
    expect(rendered.text).toContain("n'est pas enregistré en audio");
  });

  it("stamps the recording variant where recording is on", async () => {
    vi.stubEnv("RECORDING_ENABLED", "1");
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "en" }),
    );

    const { invitation, session } = await writes();
    const rendered = candidateConsentCopyFor("en", true);

    expect(session).toMatchObject({
      consentCopyVersion: "candidate-consent-v3",
      consentLanguage: "en",
    });
    expect(invitation).toMatchObject({
      consentCopyVersion: "candidate-consent-v3",
    });
    expect(session?.consentCopyVersion).toBe(rendered.version);
    expect(rendered.text).toContain("90 days");
  });

  it("stamps the rendered variant on a newly created session too", async () => {
    vi.stubEnv("RECORDING_ENABLED", "0");
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      openedInvitation({ language: "en" }),
    );
    prismaMock.candidateSession.findFirst.mockResolvedValue(null);
    prismaMock.candidateSession.create.mockResolvedValue({
      id: "cs_new",
      interviewId: "interview_1",
      resumeToken: "cs_new_resume",
    });

    await expect(
      prepareCandidateSession({
        candidateToken: "tok_candidate",
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(prismaMock.candidateSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consentCopyVersion: candidateConsentCopyFor("en", false).version,
        consentLanguage: "en",
      }),
    });
  });
});

/**
 * LF-T3b, defect D1. Erasure terminates the invitation (status "expired" +
 * expiresAt pinned to the erasure instant) precisely so the link already sitting
 * in the candidate's inbox stops working. That only holds if THIS side refuses
 * it — otherwise the next click starts a fresh session and re-collects the name
 * and email the erasure just deleted, and the data subject undoes their own
 * erasure by clicking their own link.
 */
describe("an erased candidate's invitation link is dead", () => {
  /** Exactly what `eraseCandidateSessionData` leaves behind on the invitation. */
  function erasedInvitation() {
    return {
      ...openedInvitation(),
      candidateEmail: null,
      candidateName: null,
      // Pinned to the erasure instant, which is in the past by the time anyone
      // clicks. The token itself survives as an opaque id — it is the thing that
      // must now be inert.
      expiresAt: new Date("2026-08-13T09:00:00.000Z"),
      status: "expired",
    };
  }

  it("refuses to start a live session on an erased invitation", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue(
      erasedInvitation(),
    );

    await expect(
      prepareCandidateSession({
        candidateToken: "tok_candidate",
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({
      error: "candidate_session_expired",
      ok: false,
      status: 410,
    });

    // The decisive assertion: no new session row, so nothing re-collects the
    // identity that was erased.
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("refuses the form fallback on an erased invitation too", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...erasedInvitation(),
      interview: {
        ...erasedInvitation().interview,
        responseModes: ["audio", "form"],
      },
    });

    await expect(
      submitCandidateFormInterview({
        answers: [{ questionId: "q1", text: "I would still like to answer." }],
        candidateEmail: "ada@example.com",
        candidateName: "Ada",
        candidateToken: "tok_candidate",
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({
      error: "candidate_session_expired",
      ok: false,
      status: 410,
    });

    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("refuses on the terminal status alone, even if the date were still open", async () => {
    // Belt and braces: erasure writes BOTH, and either one on its own must be
    // enough. A future migration that stopped writing one must not silently
    // reopen the link.
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...erasedInvitation(),
      expiresAt: new Date("2026-08-20T09:00:00.000Z"),
    });

    await expect(
      prepareCandidateSession({
        candidateToken: "tok_candidate",
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({
      error: "candidate_session_expired",
      ok: false,
      status: 410,
    });
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("refuses on the past date alone, even if the status were not terminal", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValue({
      ...erasedInvitation(),
      status: "opened",
    });

    await expect(
      prepareCandidateSession({
        candidateToken: "tok_candidate",
        consentAccepted: true,
      }),
    ).resolves.toMatchObject({
      error: "candidate_session_expired",
      ok: false,
      status: 410,
    });
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });
});
