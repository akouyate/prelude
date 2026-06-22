import { describe, expect, it, vi } from "vitest";

import {
  logInterviewGenerationEvent,
  type InterviewGenerationTelemetrySink,
} from "./interview-generation-telemetry";

function captureSink() {
  const records: Array<{
    level: "info" | "warn";
    payload: Record<string, unknown>;
  }> = [];
  const sink: InterviewGenerationTelemetrySink = {
    info: (payload) => records.push({ level: "info", payload }),
    warn: (payload) => records.push({ level: "warn", payload }),
  };
  return { records, sink };
}

describe("interview generation telemetry", () => {
  it("warns with a structured payload when the AI generator falls back", () => {
    const { records, sink } = captureSink();

    logInterviewGenerationEvent(
      {
        event: "ai_draft_fallback",
        provider: "openai_responses",
        model: "gpt-test",
        reason: "openai_error",
      },
      sink,
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe("warn");
    expect(records[0]?.payload).toMatchObject({
      event: "ai_draft_fallback",
      provider: "openai_responses",
      model: "gpt-test",
      reason: "openai_error",
    });
    expect(records[0]?.payload.scope).toBe("interview_generation");
  });

  it("warns when policy violations drop generated items", () => {
    const { records, sink } = captureSink();

    logInterviewGenerationEvent(
      {
        event: "policy_violation_dropped",
        droppedQuestions: 2,
        droppedCriteria: 1,
      },
      sink,
    );

    expect(records[0]?.level).toBe("warn");
    expect(records[0]?.payload).toMatchObject({
      event: "policy_violation_dropped",
      droppedQuestions: 2,
      droppedCriteria: 1,
    });
  });

  it("logs the N6 classifier outcome at info level", () => {
    const { records, sink } = captureSink();

    logInterviewGenerationEvent(
      {
        event: "protected_topic_classification",
        outcome: "clean",
        provider: "openai_responses",
        model: "gpt-4.1-mini",
        segmentCount: 8,
      },
      sink,
    );

    expect(records[0]?.level).toBe("info");
    expect(records[0]?.payload).toMatchObject({
      event: "protected_topic_classification",
      outcome: "clean",
      segmentCount: 8,
    });
  });

  it("falls back to console by default and never throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      logInterviewGenerationEvent({
        event: "ai_draft_fallback",
        provider: "openai_responses",
        model: "gpt-test",
        reason: "openai_error",
      }),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload] = warnSpy.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      scope: "interview_generation",
      event: "ai_draft_fallback",
    });

    warnSpy.mockRestore();
  });
});
