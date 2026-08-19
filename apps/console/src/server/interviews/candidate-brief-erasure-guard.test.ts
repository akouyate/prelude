import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LF-T3b: an erased candidate must not acquire a brief.
 *
 * The detail page hides the generate/regenerate affordances once `erasedAt` is
 * set, but UI is not enforcement — a tab opened before the erasure still holds a
 * live server action, and `auto-generate-brief` fires one from an effect. Both
 * land in `generateCandidateBriefForSession`, which is the single choke point
 * for every generation route (`generateCandidateBriefAction` is its only
 * caller, and the two detail-page forms plus the auto-generation effect are that
 * action's only callers).
 *
 * What is pinned here is the ONE thing that matters: `candidateBrief.upsert` is
 * never reached. That upsert is the write that would resurrect the deleted row —
 * empty, since the Go transcript events are gone — and show the recruiter a
 * fresh assessment of a person whose data we said was destroyed.
 */
const prismaMock = vi.hoisted(() => ({
  candidateBrief: { update: vi.fn(), upsert: vi.fn() },
  candidateSession: { findFirst: vi.fn() },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/notifications", () => ({
  createNotificationDispatcher: () => ({ notifyCandidateBrief: vi.fn() }),
}));
vi.mock("./live-session-evidence", () => ({
  getCandidateSessionEvidence: vi.fn(),
}));

import { generateCandidateBriefForSession } from "./candidate-brief-generation";
import {
  getCandidateSessionEvidence,
  type CandidateSessionEvidence,
} from "./live-session-evidence";

function session(overrides: Record<string, unknown> = {}) {
  return {
    candidateBrief: null,
    candidateEmail: "ada@example.com",
    candidateName: "Ada Martin",
    erasedAt: null,
    id: "cs_123",
    interview: { criteria: [], questions: [], roleTitle: "CSM" },
    job: { title: "CSM" },
    organization: { settings: {} },
    organizationId: "org_123",
    ...overrides,
  };
}

/** An erased session: identity nulled, brief row already deleted. */
function erasedSession() {
  return session({
    candidateBrief: null,
    candidateEmail: null,
    candidateName: null,
    erasedAt: new Date("2026-08-19T09:00:00.000Z"),
  });
}

function evidence(): CandidateSessionEvidence {
  return {
    completedAt: null,
    eventCount: 0,
    questionAnswerSequence: [],
    questionCompletionRate: 0,
    recording: null,
    status: "completed",
    transcriptTurns: [],
  } as unknown as CandidateSessionEvidence;
}

function passthroughSynthesizer() {
  return {
    modelName: "test",
    provider: "test",
    synthesize: async () => {
      throw new Error("the synthesizer must never run for an erased session");
    },
  };
}

describe("brief generation refuses an erased candidate session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.candidateBrief.upsert.mockResolvedValue({});
    prismaMock.candidateBrief.update.mockResolvedValue({});
    vi.mocked(getCandidateSessionEvidence).mockResolvedValue(evidence());
  });

  it("skips with candidate_session_erased and never writes a brief", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValue(erasedSession());

    const result = await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(result).toEqual({
      reason: "candidate_session_erased",
      status: "skipped",
    });
    // The decisive assertion: the resurrecting write is never reached.
    expect(prismaMock.candidateBrief.upsert).not.toHaveBeenCalled();
    expect(prismaMock.candidateBrief.update).not.toHaveBeenCalled();
  });

  it("short-circuits before any evidence is read", async () => {
    // Reading the (now empty) event log would be harmless but pointless, and it
    // is the step that used to produce the empty brief.
    prismaMock.candidateSession.findFirst.mockResolvedValue(erasedSession());

    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(getCandidateSessionEvidence).not.toHaveBeenCalled();
  });

  it("still generates for a session that was not erased", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValue(session());

    const result = await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: {
        modelName: "test",
        provider: "test",
        synthesize: async () => {
          throw new Error("fall back to the local brief");
        },
      },
    });

    expect(result.status).not.toBe("skipped");
    expect(prismaMock.candidateBrief.upsert).toHaveBeenCalled();
  });

  it("keeps refusing a session erased by the retention sweep, not just on request", async () => {
    prismaMock.candidateSession.findFirst.mockResolvedValue(
      session({
        candidateEmail: null,
        candidateName: null,
        erasedAt: new Date("2026-08-19T09:00:00.000Z"),
        erasureReason: "retention",
      }),
    );

    const result = await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(result).toEqual({
      reason: "candidate_session_erased",
      status: "skipped",
    });
    expect(prismaMock.candidateBrief.upsert).not.toHaveBeenCalled();
  });
});
