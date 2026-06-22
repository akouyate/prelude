/**
 * N9: structured telemetry for the interview-plan generator pipeline.
 *
 * These events make the otherwise-silent failure modes of generation auditable:
 *   - the AI generator falling back to Prelude's deterministic templates,
 *   - the keyword policy filter dropping generated questions/criteria, and
 *   - the N6 protected-topic classifier outcome at publish.
 *
 * The sink is injectable so callers (and tests) can capture events; by default
 * it routes to console with a stable `scope` so log pipelines can filter it.
 */

export type InterviewGenerationFallbackReason =
  | "openai_error"
  | "openai_incomplete_payload";

export type AiDraftFallbackEvent = {
  event: "ai_draft_fallback";
  provider: string;
  model: string;
  reason: InterviewGenerationFallbackReason;
};

export type PolicyViolationDroppedEvent = {
  event: "policy_violation_dropped";
  droppedQuestions: number;
  droppedCriteria: number;
};

export type ProtectedTopicClassificationOutcome =
  | "clean"
  | "flagged"
  | "skipped_error"
  | "disabled";

export type ProtectedTopicClassificationEvent = {
  event: "protected_topic_classification";
  outcome: ProtectedTopicClassificationOutcome;
  provider: string;
  model: string;
  segmentCount: number;
  category?: string;
};

export type InterviewGenerationTelemetryEvent =
  | AiDraftFallbackEvent
  | PolicyViolationDroppedEvent
  | ProtectedTopicClassificationEvent;

export type InterviewGenerationTelemetrySink = {
  info: (payload: Record<string, unknown>) => void;
  warn: (payload: Record<string, unknown>) => void;
};

const telemetryScope = "interview_generation";

const consoleSink: InterviewGenerationTelemetrySink = {
  info: (payload) => {
    // eslint-disable-next-line no-console
    console.info(payload);
  },
  warn: (payload) => {
    // eslint-disable-next-line no-console
    console.warn(payload);
  },
};

function isWarnEvent(event: InterviewGenerationTelemetryEvent): boolean {
  if (event.event === "ai_draft_fallback") {
    return true;
  }

  if (event.event === "policy_violation_dropped") {
    return event.droppedQuestions > 0 || event.droppedCriteria > 0;
  }

  // protected_topic_classification: flags and hard errors are warnings; a clean
  // pass (or a disabled classifier) is an informational audit breadcrumb.
  return event.outcome === "flagged" || event.outcome === "skipped_error";
}

export function logInterviewGenerationEvent(
  event: InterviewGenerationTelemetryEvent,
  sink: InterviewGenerationTelemetrySink = consoleSink,
): void {
  const payload: Record<string, unknown> = {
    scope: telemetryScope,
    ...event,
  };

  try {
    if (isWarnEvent(event)) {
      sink.warn(payload);
    } else {
      sink.info(payload);
    }
  } catch {
    // Telemetry must never break the generation or publish path.
  }
}
