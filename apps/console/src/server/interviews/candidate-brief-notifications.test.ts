import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateBrief: {
    update: vi.fn(),
    upsert: vi.fn(),
  },
  candidateSession: {
    findFirst: vi.fn(),
  },
}));

const notificationMock = vi.hoisted(() => ({
  notifyCandidateBrief: vi.fn(),
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/notifications", () => ({
  createNotificationDispatcher: () => notificationMock,
}));
vi.mock("./live-session-evidence", () => ({
  getCandidateSessionEvidence: vi.fn(),
}));

import { getCandidateSessionEvidence } from "./live-session-evidence";
import { generateCandidateBriefForSession } from "./candidate-brief-generation";

describe("candidate brief notification trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.candidateSession.findFirst.mockResolvedValue({
      candidateBrief: null,
      candidateEmail: "ada@example.com",
      candidateName: "Ada Martin",
      id: "cs_123",
      interview: {
        criteria: [],
        questions: [],
        roleTitle: "Customer Success Manager",
      },
      job: { title: "Customer Success Manager" },
      organizationId: "org_123",
    });
    prismaMock.candidateBrief.upsert.mockResolvedValue({});
    prismaMock.candidateBrief.update.mockResolvedValue({});
    vi.mocked(getCandidateSessionEvidence).mockResolvedValue({
      completedAt: "2026-07-17T10:00:00.000Z",
      eventCount: 1,
      failedAt: null,
      questionAnswerSequence: [],
      questionCompletionRate: 100,
      realtimeSessionId: "is_123",
      recording: null,
      runtimeStatus: "completed",
      status: "completed",
      terminalEventType: "session_completed",
      transcriptTurns: [
        {
          endedAt: "2026-07-17T10:00:20.000Z",
          eventType: "candidate_turn_finalized",
          questionId: "question_123",
          sequenceNumber: 1,
          speaker: "candidate",
          startedAt: "2026-07-17T10:00:00.000Z",
          text: "I led a customer onboarding project, aligned support and product, and reduced activation delays with a weekly risk review.",
          turnId: "turn_123",
        },
      ],
    });
  });

  it("notifies only after the completed brief has been persisted", async () => {
    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: {
        modelName: "test",
        provider: "test",
        synthesize: async () => ({
          candidateSessionId: "cs_123",
          complianceFlags: [],
          criteria: [],
          limitations: [],
          pointsToClarify: [],
          risks: [],
          status: "completed",
          strengths: [],
        }),
      },
    });

    expect(prismaMock.candidateBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
        where: { candidateSessionId: "cs_123" },
      }),
    );
    expect(notificationMock.notifyCandidateBrief).toHaveBeenCalledWith({
      candidateSessionId: "cs_123",
      status: "completed",
    });
  });

  it("emits an actionable notification when persistence reaches the failed state", async () => {
    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: {
        modelName: "test",
        provider: "test",
        synthesize: async () => {
          throw new Error("unavailable");
        },
      },
    });

    expect(prismaMock.candidateBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
        where: { candidateSessionId: "cs_123" },
      }),
    );
    expect(notificationMock.notifyCandidateBrief).toHaveBeenCalledWith({
      candidateSessionId: "cs_123",
      status: "failed",
    });
  });
});
