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

import type { CandidateBriefSynthesizerInput } from "./candidate-brief-generation";
import { generateCandidateBriefForSession } from "./candidate-brief-generation";
import {
  getCandidateSessionEvidence,
  type CandidateSessionEvidence,
} from "./live-session-evidence";

// Plan 2026-08-18, rule 6: the brief carries the language it was generated in,
// resolved server-side from the workspace setting at generation time.
describe("candidate brief language stamping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorkspaceSettings({ workspaceLanguage: "fr" });
    prismaMock.candidateBrief.upsert.mockResolvedValue({});
    prismaMock.candidateBrief.update.mockResolvedValue({});
    vi.mocked(getCandidateSessionEvidence).mockResolvedValue(evidence());
  });

  it("stamps the workspace language on a generated brief", async () => {
    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(lastUpdateData()).toMatchObject({
      language: "fr",
      status: "completed",
    });
  });

  it("hands the resolved language to the synthesizer", async () => {
    const seen: CandidateBriefSynthesizerInput[] = [];

    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(seen),
    });

    expect(seen[0]?.language).toBe("fr");
  });

  it("falls back to English when the workspace never set a language", async () => {
    setWorkspaceSettings({});

    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(lastUpdateData()).toMatchObject({ language: "en" });
  });

  // Regeneration is the recruiter re-running the analysis today: it must follow
  // today's workspace language, not the one stored on the previous attempt.
  it("re-resolves the current workspace language on regeneration", async () => {
    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(lastUpdateData()).toMatchObject({ language: "fr" });

    setWorkspaceSettings({ workspaceLanguage: "en" });

    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: passthroughSynthesizer(),
    });

    expect(lastUpdateData()).toMatchObject({ language: "en" });
  });

  // The stamp describes the content in the row. A first-ever failure leaves the
  // column null because nothing ever stamped it, not because the failure wrote
  // a null.
  it("stamps no language when a first-ever generation fails", async () => {
    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: failingSynthesizer(),
    });

    expect(lastUpdateData()).toMatchObject({ status: "failed" });
    expect(lastUpdateData()).not.toHaveProperty("language");
  });

  // A failed regeneration keeps the previous brief's summaryJson — which the
  // recruiter still reads — so the row must keep that content's language too.
  // Nulling it here would make the stamp lie about what is on screen.
  it("keeps the previous stamp when a regeneration fails over an existing brief", async () => {
    setWorkspaceSettings(
      { workspaceLanguage: "en" },
      {
        language: "fr",
        status: "completed",
        summaryJson: { status: "completed", summary: "Compte rendu français." },
      },
    );

    await generateCandidateBriefForSession({
      candidateSessionId: "cs_123",
      organizationId: "org_123",
      synthesizer: failingSynthesizer(),
    });

    expect(lastUpdateData()).toMatchObject({ status: "failed" });
    expect(lastUpdateData()).not.toHaveProperty("language");
    expect(lastUpdateData()).not.toHaveProperty("summaryJson");
  });
});

function setWorkspaceSettings(
  settings: Record<string, unknown>,
  candidateBrief: Record<string, unknown> | null = null,
) {
  prismaMock.candidateSession.findFirst.mockResolvedValue({
    candidateBrief,
    candidateEmail: "ada@example.com",
    candidateName: "Ada Martin",
    id: "cs_123",
    interview: {
      criteria: [],
      questions: [],
      roleTitle: "Customer Success Manager",
    },
    job: { title: "Customer Success Manager" },
    organization: { settings },
    organizationId: "org_123",
  });
}

function lastUpdateData() {
  const calls = prismaMock.candidateBrief.update.mock.calls;

  return calls[calls.length - 1]?.[0]?.data;
}

function failingSynthesizer() {
  return {
    modelName: "test",
    provider: "test",
    synthesize: async () => {
      throw new Error("unavailable");
    },
  };
}

function passthroughSynthesizer(
  seen: CandidateBriefSynthesizerInput[] = [],
): Parameters<typeof generateCandidateBriefForSession>[0]["synthesizer"] {
  return {
    modelName: "test",
    provider: "test",
    synthesize: async (input) => {
      seen.push(input);

      return {
        candidateSessionId: input.candidateSessionId,
        complianceFlags: [],
        criteria: [],
        limitations: [],
        pointsToClarify: [],
        risks: [],
        status: "completed",
        strengths: [],
      };
    },
  };
}

function evidence(): CandidateSessionEvidence {
  return {
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
  };
}
