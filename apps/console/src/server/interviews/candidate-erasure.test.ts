import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The erasure core, under test as the ONE code path both entries share: the
 * recruiter's on-request erasure and the 12-month retention sweep. What is
 * pinned here is the write set — what disappears, and precisely what survives as
 * the Art. 17(3) tombstone — because that set is a legal commitment (the
 * candidate consent copy promises it), not an implementation detail.
 */
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  candidateBrief: { deleteMany: vi.fn() },
  candidateInvitation: { updateMany: vi.fn() },
  candidateSession: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@prelude/db", () => ({ prisma: prismaMock }));

import { candidateLifecycleTerminalStatuses } from "@prelude/core";

import {
  candidateDataRetentionMonths,
  eraseCandidateSessionData,
  erasureReasonRequest,
  erasureReasonRetention,
  retentionCutoffFor,
  sweepExpiredCandidateData,
} from "./candidate-erasure";

const now = new Date("2026-08-19T09:00:00.000Z");

function resetMocks() {
  prismaMock.$transaction.mockReset();
  prismaMock.candidateBrief.deleteMany.mockReset();
  prismaMock.candidateInvitation.updateMany.mockReset();
  prismaMock.candidateSession.findFirst.mockReset();
  prismaMock.candidateSession.findMany.mockReset();
  prismaMock.candidateSession.updateMany.mockReset();
  // The real `$transaction` takes an array of promises; the house mock resolves
  // them so the operation builders above are still exercised.
  prismaMock.$transaction.mockImplementation(async (operations: unknown) =>
    Array.isArray(operations) ? Promise.all(operations) : operations,
  );
}

describe("eraseCandidateSessionData", () => {
  beforeEach(() => {
    resetMocks();
    vi.stubEnv("PRELUDE_REALTIME_API_URL", "http://realtime.test");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is organization-scoped: a session in another workspace is never found, and nothing is written", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);

    const result = await eraseCandidateSessionData({
      candidateSessionId: "cs_other_org",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    expect(result).toEqual({ erased: false, reason: "not_found" });
    expect(prismaMock.candidateSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cs_other_org", organizationId: "org_123" },
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("erases the realtime side first, then writes the tombstone", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "inv_1",
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: "is_real",
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    expect(result).toEqual({ erased: true, realtimeSessionId: "is_real" });
    // The Go service owns the audio objects and the append-only event log; the
    // console has neither, so it delegates and only then writes locally.
    expect(fetch).toHaveBeenCalledWith(
      "http://realtime.test/v1/interview-sessions/is_real/personal-data",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("writes exactly the tombstone: identity cleared, billing trace preserved", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "inv_1",
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: "is_real",
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    // The brief row goes entirely — it is generated assessment about a person.
    expect(prismaMock.candidateBrief.deleteMany).toHaveBeenCalledWith({
      where: { candidateSessionId: "cs_1", organizationId: "org_123" },
    });

    const sessionUpdate = prismaMock.candidateSession.updateMany.mock.calls[0]?.[0];
    expect(sessionUpdate).toEqual({
      data: {
        candidateEmail: null,
        candidateName: null,
        erasedAt: now,
        erasureReason: erasureReasonRequest,
        resumeToken: null,
      },
      where: { id: "cs_1", organizationId: "org_123" },
    });
    // Nothing else is touched — the surviving fields are surviving by omission,
    // which is what keeps status/timestamps/billedAnsweredCount/
    // billedRequiredCount/billedOutcome intact without naming them here.
    expect(Object.keys(sessionUpdate.data).sort()).toEqual([
      "candidateEmail",
      "candidateName",
      "erasedAt",
      "erasureReason",
      "resumeToken",
    ]);

    // The invitation carries the same identity, so it is cleared too — AND the
    // link is terminated in the same write. The emailed URL is a live
    // credential: left usable, the next click starts a fresh session that
    // re-collects the very name and email just erased.
    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: {
        candidateEmail: null,
        candidateName: null,
        expiresAt: now,
        status: "expired",
      },
      where: { id: "inv_1", organizationId: "org_123" },
    });
  });

  it("terminates the link with an EXISTING terminal status, not an invented one", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "inv_1",
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: null,
    });

    await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    const invitationUpdate =
      prismaMock.candidateInvitation.updateMany.mock.calls[0]?.[0];
    // "expired" is in @prelude/core's terminal set, and is exactly what
    // `prepareCandidateSession` refuses with 410.
    expect(candidateLifecycleTerminalStatuses).toContain(
      invitationUpdate.data.status,
    );
    expect(invitationUpdate.data.status).toBe("expired");
    // Status AND date, because different readers enforce different ones.
    expect(invitationUpdate.data.expiresAt).toEqual(now);
  });

  it("carries organizationId on every write in the transaction, not just the read", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "inv_1",
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: null,
    });

    await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    // The ids all come from an org-filtered `findFirst`, so this is defence in
    // depth rather than a live hole — but a destructive transaction should state
    // its tenant on every statement, so no future edit can widen one of them by
    // dropping a filter nobody notices is missing.
    const writes = [
      prismaMock.candidateBrief.deleteMany.mock.calls[0]?.[0],
      prismaMock.candidateSession.updateMany.mock.calls[0]?.[0],
      prismaMock.candidateInvitation.updateMany.mock.calls[0]?.[0],
    ];
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      expect(write.where.organizationId).toBe("org_123");
    }
  });

  it("skips the invitation update when the session has none", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: null,
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: null,
    });

    await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    expect(prismaMock.candidateInvitation.updateMany).not.toHaveBeenCalled();
  });

  it("erases a session that never reached the realtime service", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: null,
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: null,
    });

    const result = await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRequest,
    });

    expect(result).toEqual({ erased: true, realtimeSessionId: null });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.updateMany).toHaveBeenCalled();
  });

  it("throws without writing the tombstone when the realtime erasure fails", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: null,
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: "is_real",
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(
      eraseCandidateSessionData({
        candidateSessionId: "cs_1",
        now,
        organizationId: "org_123",
        reason: erasureReasonRequest,
      }),
    ).rejects.toThrow();
    // A tombstone over surviving content would be a lie the UI then repeats.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("is idempotent and keeps the FIRST erasure timestamp and reason", async () => {
    const firstErasure = new Date("2026-01-05T08:00:00.000Z");
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: null,
      erasedAt: firstErasure,
      erasureReason: erasureReasonRequest,
      id: "cs_1",
      realtimeSessionId: "is_real",
    });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRetention,
    });

    const sessionUpdate = prismaMock.candidateSession.updateMany.mock.calls[0]?.[0];
    expect(sessionUpdate.data.erasedAt).toEqual(firstErasure);
    expect(sessionUpdate.data.erasureReason).toBe(erasureReasonRequest);
  });

  it("does not move the invitation's expiry on a re-run either", async () => {
    const firstErasure = new Date("2026-01-05T08:00:00.000Z");
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "inv_1",
      erasedAt: firstErasure,
      erasureReason: erasureReasonRequest,
      id: "cs_1",
      realtimeSessionId: null,
    });

    await eraseCandidateSessionData({
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_123",
      reason: erasureReasonRetention,
    });

    // One instant stamps the whole erasure — the moment the right was honoured,
    // not the moment someone retried.
    const invitationUpdate =
      prismaMock.candidateInvitation.updateMany.mock.calls[0]?.[0];
    expect(invitationUpdate.data.expiresAt).toEqual(firstErasure);
    expect(invitationUpdate.data.status).toBe("expired");
  });
});

describe("sweepExpiredCandidateData", () => {
  beforeEach(() => {
    resetMocks();
    vi.stubEnv("PRELUDE_REALTIME_API_URL", "http://realtime.test");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("anchors the horizon on completedAt, 12 months back", () => {
    expect(candidateDataRetentionMonths).toBe(12);
    expect(retentionCutoffFor(now)).toEqual(new Date("2025-08-19T09:00:00.000Z"));
  });

  it("selects only completed sessions past the cutoff that are not already erased", async () => {
    prismaMock.candidateSession.findMany.mockResolvedValueOnce([]);

    await sweepExpiredCandidateData({ limit: 50, now });

    expect(prismaMock.candidateSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          completedAt: { lte: retentionCutoffFor(now), not: null },
          erasedAt: null,
        },
      }),
    );
  });

  it("runs the same erasure path per session, with the retention reason", async () => {
    prismaMock.candidateSession.findMany.mockResolvedValueOnce([
      { id: "cs_old_1", organizationId: "org_a" },
      { id: "cs_old_2", organizationId: "org_b" },
    ]);
    prismaMock.candidateSession.findFirst
      .mockResolvedValueOnce({
        candidateInvitationId: null,
        erasedAt: null,
        erasureReason: null,
        id: "cs_old_1",
        realtimeSessionId: null,
      })
      .mockResolvedValueOnce({
        candidateInvitationId: null,
        erasedAt: null,
        erasureReason: null,
        id: "cs_old_2",
        realtimeSessionId: null,
      });

    const report = await sweepExpiredCandidateData({ limit: 50, now });

    expect(report).toEqual(
      expect.objectContaining({ erased: 2, failed: 0, scanned: 2 }),
    );
    // Each session is erased in ITS OWN organization's scope — the sweep is
    // cross-workspace, so a shared scope would be a cross-tenant write.
    expect(prismaMock.candidateSession.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "cs_old_1", organizationId: "org_a" },
      }),
    );
    expect(prismaMock.candidateSession.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "cs_old_2", organizationId: "org_b" },
      }),
    );
    for (const [update] of prismaMock.candidateSession.updateMany.mock.calls) {
      expect(update.data.erasureReason).toBe(erasureReasonRetention);
    }
  });

  it("counts a failing session and keeps sweeping the rest", async () => {
    prismaMock.candidateSession.findMany.mockResolvedValueOnce([
      { id: "cs_bad", organizationId: "org_a" },
      { id: "cs_good", organizationId: "org_a" },
    ]);
    prismaMock.candidateSession.findFirst
      .mockResolvedValueOnce({
        candidateInvitationId: null,
        erasedAt: null,
        erasureReason: null,
        id: "cs_bad",
        realtimeSessionId: "is_bad",
      })
      .mockResolvedValueOnce({
        candidateInvitationId: null,
        erasedAt: null,
        erasureReason: null,
        id: "cs_good",
        realtimeSessionId: null,
      });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));

    const report = await sweepExpiredCandidateData({ limit: 50, now });

    expect(report).toEqual(
      expect.objectContaining({ erased: 1, failed: 1, scanned: 2 }),
    );
  });

  it("reports hasMore when the page came back full", async () => {
    prismaMock.candidateSession.findMany.mockResolvedValueOnce([
      { id: "cs_1", organizationId: "org_a" },
    ]);
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: null,
      erasedAt: null,
      erasureReason: null,
      id: "cs_1",
      realtimeSessionId: null,
    });

    const report = await sweepExpiredCandidateData({ limit: 1, now });

    expect(report.hasMore).toBe(true);
  });
});
