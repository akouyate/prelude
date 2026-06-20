import { describe, expect, it } from "vitest";

import {
  buildLocalCandidateBrief,
  type CandidateBriefSynthesizerInput,
} from "./candidate-brief-generation";

describe("candidate brief generation", () => {
  it("builds a structured brief from transcript evidence", () => {
    const brief = buildLocalCandidateBrief(input());

    expect(brief.status).toBe("completed");
    expect(brief.summary).toContain("Ada");
    expect(brief.criteria).toHaveLength(2);
    expect(brief.criteria.map((criterion) => criterion.status)).toEqual([
      "Medium",
      "Medium",
    ]);
    expect(brief.criteria[0]?.evidence[0]).toMatchObject({
      questionId: "q1",
      transcriptTurnId: "turn_a1",
    });
    expect(JSON.stringify(brief).toLowerCase()).not.toContain("score");
    expect(brief.limitations.join(" ")).toContain("protected attributes");
  });

  it("marks criteria not assessable when transcript evidence is missing", () => {
    const brief = buildLocalCandidateBrief(
      input({
        evidence: {
          ...input().evidence,
          questionCompletionRate: 50,
          transcriptTurns: [],
        },
      }),
    );

    expect(
      brief.criteria.every(
        (criterion) => criterion.status === "Not assessable",
      ),
    ).toBe(true);
    expect(brief.limitations).toContain(
      "No candidate transcript turns were available.",
    );
    expect(brief.limitations).toContain(
      "The interview did not complete every planned question.",
    );
    expect(brief.pointsToClarify).toContain("Clarify customer judgement.");
  });
});

function input(
  overrides: Partial<CandidateBriefSynthesizerInput> = {},
): CandidateBriefSynthesizerInput {
  return {
    candidateLabel: "Ada",
    candidateSessionId: "cs_123",
    criteria: [
      {
        description: "Understands customer context and trade-offs.",
        id: "customer_judgement",
        label: "Customer judgement",
      },
      {
        description: "Communicates clearly in a first screen.",
        id: "communication",
        label: "Communication",
      },
    ],
    evidence: {
      completedAt: "2026-06-20T10:05:00.000Z",
      eventCount: 4,
      failedAt: null,
      questionAnswerSequence: [],
      questionCompletionRate: 100,
      realtimeSessionId: "is_123",
      runtimeStatus: "completed",
      status: "completed",
      terminalEventType: "session_completed",
      transcriptTurns: [
        {
          endedAt: "2026-06-20T10:00:10.000Z",
          eventType: "candidate_turn_finalized",
          questionId: "q1",
          sequenceNumber: 2,
          speaker: "candidate",
          startedAt: "2026-06-20T10:00:00.000Z",
          text: "I led onboarding projects for enterprise customers and coordinated support, product, and customer success teams to reduce activation delays.",
          turnId: "turn_a1",
        },
      ],
    },
    jobTitle: "Customer Success Manager",
    roleTitle: "Customer Success Manager",
    ...overrides,
  };
}
