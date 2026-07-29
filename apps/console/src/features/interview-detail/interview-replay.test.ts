import { describe, expect, it } from "vitest";

import {
  buildInterviewReplayChapters,
  formatReplayTime,
  replayOffsetMs,
} from "./interview-replay";

const questions = [
  { id: "q1", prompt: "Introduce yourself." },
  { id: "q2", prompt: "Describe a recent project." },
  { id: "q3", prompt: "How do you handle pressure?" },
];

describe("buildInterviewReplayChapters", () => {
  it("uses persisted question turns and stops each segment before the next one", () => {
    const transcriptTurns = [
      turn("i1", "q1", "interviewer", 0, 2),
      turn("c1", "q1", "candidate", 3, 14),
      turn("i2", "q2", "interviewer", 16, 20),
      turn("c2", "q2", "candidate", 21, 42),
      turn("i3", "q3", "interviewer", 45, 48),
      turn("c3", "q3", "candidate", 49, 61),
    ];

    const chapters = buildInterviewReplayChapters({
      questionAnswerSequence: [
        group("q1", transcriptTurns.slice(0, 2)),
        group("q2", transcriptTurns.slice(2, 4)),
        group("q3", transcriptTurns.slice(4)),
      ],
      questions,
      totalDurationMs: 64_000,
      transcriptTurns,
    });

    expect(chapters).toEqual([
      {
        endMs: 14_600,
        id: "q1",
        label: "Introduce yourself.",
        questionNumber: 1,
        startMs: 0,
      },
      {
        endMs: 42_600,
        id: "q2",
        label: "Describe a recent project.",
        questionNumber: 2,
        startMs: 16_000,
      },
      {
        endMs: 61_600,
        id: "q3",
        label: "How do you handle pressure?",
        questionNumber: 3,
        startMs: 45_000,
      },
    ]);
  });

  it("omits planned questions without persisted timing evidence", () => {
    const transcriptTurns = [
      turn("i2", "q2", "interviewer", 10, 12),
      turn("c2", "q2", "candidate", 13, 20),
    ];

    expect(
      buildInterviewReplayChapters({
        questionAnswerSequence: [group("q2", transcriptTurns)],
        questions,
        totalDurationMs: 30_000,
        transcriptTurns,
      }),
    ).toEqual([
      {
        endMs: 10_600,
        id: "q2",
        label: "Describe a recent project.",
        questionNumber: 2,
        startMs: 0,
      },
    ]);
  });

  it("falls back to transcript question identifiers when grouped evidence is missing", () => {
    const transcriptTurns = [
      turn("i1", "q1", "interviewer", 0, 2),
      turn("c1", "q1", "candidate", 3, 9),
      turn("i2", "q2", "interviewer", 11, 14),
      turn("c2", "q2", "candidate", 15, 24),
    ];

    expect(
      buildInterviewReplayChapters({
        questionAnswerSequence: [],
        questions,
        totalDurationMs: 25_000,
        transcriptTurns,
      }),
    ).toEqual([
      {
        endMs: 9_600,
        id: "q1",
        label: "Introduce yourself.",
        questionNumber: 1,
        startMs: 0,
      },
      {
        endMs: 24_600,
        id: "q2",
        label: "Describe a recent project.",
        questionNumber: 2,
        startMs: 11_000,
      },
    ]);
  });
});

describe("replay time helpers", () => {
  it("formats offsets and rejects invalid timestamps", () => {
    const turns = [turn("i1", "q1", "interviewer", 5, 8)];

    expect(replayOffsetMs("2026-07-29T10:00:12.000Z", turns)).toBe(7_000);
    expect(replayOffsetMs("invalid", turns)).toBe(0);
    expect(formatReplayTime(3_725_000)).toBe("1:02:05");
  });
});

function turn(
  id: string,
  questionId: string,
  speaker: "candidate" | "interviewer",
  startSeconds: number,
  endSeconds: number,
) {
  return {
    endedAt: timeAt(endSeconds),
    questionId,
    speaker,
    startedAt: timeAt(startSeconds),
    turnId: id,
  };
}

function group(questionId: string, turns: ReturnType<typeof turn>[]) {
  return {
    candidateTurns: turns.filter((item) => item.speaker === "candidate"),
    interviewerTurns: turns.filter((item) => item.speaker === "interviewer"),
    questionId,
  };
}

function timeAt(seconds: number) {
  return new Date(
    new Date("2026-07-29T10:00:00.000Z").getTime() + seconds * 1_000,
  ).toISOString();
}
