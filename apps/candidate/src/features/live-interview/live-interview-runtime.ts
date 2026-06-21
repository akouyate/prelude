import type {
  LiveSessionEvent,
  LiveSessionState,
  LiveTranscriptTurn,
  RoomStatus,
} from "./live-interview-types";

export function statusFromSessionState(state: LiveSessionState): RoomStatus {
  if (state.status === "failed" || hasEventType(state.events, "session_failed")) {
    return "failed";
  }
  if (
    state.status === "completed" ||
    hasEventType(state.events, "session_completed")
  ) {
    return "completed";
  }

  const runtimeEvents = [...state.events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => runtimeEventTypes.has(event.type));
  const latestEvent = runtimeEvents[runtimeEvents.length - 1];

  if (!latestEvent) {
    return statusFromRealtimeSessionStatus(state.status);
  }

  switch (latestEvent.type) {
    case "session_closing":
      return "closing";
    case "agent_speech_started":
    case "question_asked":
    case "question_repeated":
    case "soft_reprompted":
    case "followup_asked":
      return "interviewer_speaking";
    case "candidate_speech_started":
    case "candidate_turn_started":
    case "candidate_turn_detected":
      return "candidate_speaking";
    case "agent_joined":
    case "session_started":
      return "agent_joined";
    case "candidate_media_ready":
      return "interviewer_joining";
    case "candidate_turn_finalized":
    case "candidate_speech_stopped":
    case "answer_evaluated":
    case "question_completed":
    case "agent_speech_completed":
    case "silence_timeout_started":
    case "wait_requested":
      return "listening";
    default:
      return statusFromRealtimeSessionStatus(state.status);
  }
}

export function statusFromTranscriptTurn(
  turn: LiveTranscriptTurn,
  currentStatus: RoomStatus,
): RoomStatus {
  if (
    currentStatus === "reconnecting" ||
    currentStatus === "closing" ||
    currentStatus === "completed" ||
    currentStatus === "failed"
  ) {
    return currentStatus;
  }
  if (turn.speaker === "interviewer") {
    return "interviewer_speaking";
  }
  if (turn.speaker === "candidate") {
    return "candidate_speaking";
  }

  return currentStatus;
}

export function shouldKeepCurrentRuntimeStatus(
  currentStatus: RoomStatus,
  nextStatus: RoomStatus,
) {
  if (currentStatus === "reconnecting" && !terminalStatuses.has(nextStatus)) {
    return true;
  }
  if (currentStatus === "closing" && nextStatus !== "failed") {
    return true;
  }
  if (currentStatus === "completed" || currentStatus === "failed") {
    return true;
  }

  return false;
}

export function transcriptTurnsFromSessionState(state: LiveSessionState) {
  return state.events.flatMap((event) => {
    const turn = transcriptTurnFromEvent(event);
    return turn ? [turn] : [];
  });
}

export function hasClosingTranscript(state: LiveSessionState) {
  return state.events.some(
    (event) =>
      event.type === "session_closing" && transcriptTurnFromEvent(event) !== null,
  );
}

function statusFromRealtimeSessionStatus(status: string): RoomStatus {
  if (status === "agent_joining") {
    return "interviewer_joining";
  }
  if (status === "in_progress") {
    return "connected";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "completed") {
    return "completed";
  }

  return "connecting";
}

function transcriptTurnFromEvent(event: LiveSessionEvent) {
  const payloadTurn =
    readRecord(event.payload.transcriptTurn) ??
    readRecord(event.payload.transcript_turn);
  if (!payloadTurn) {
    return null;
  }

  const turnId = readString(payloadTurn.turnId ?? payloadTurn.turn_id);
  const sessionId = readString(payloadTurn.sessionId ?? payloadTurn.session_id);
  const speaker = readSpeaker(payloadTurn.speaker);
  const text = readString(payloadTurn.text);
  const startedAt = readString(payloadTurn.startedAt ?? payloadTurn.started_at);
  if (!turnId || !sessionId || !speaker || !text || !startedAt) {
    return null;
  }

  return {
    turnId,
    sessionId,
    questionId: readString(payloadTurn.questionId ?? payloadTurn.question_id),
    speaker,
    text,
    isFinal: readBoolean(payloadTurn.isFinal ?? payloadTurn.is_final),
    startedAt,
    endedAt: readString(payloadTurn.endedAt ?? payloadTurn.ended_at),
  } satisfies LiveTranscriptTurn;
}

function hasEventType(events: LiveSessionEvent[], type: string) {
  return events.some((event) => event.type === type);
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : true;
}

function readSpeaker(value: unknown) {
  if (value === "candidate" || value === "interviewer" || value === "system") {
    return value;
  }

  return undefined;
}

const runtimeEventTypes = new Set([
  "candidate_media_ready",
  "agent_joined",
  "session_started",
  "agent_speech_started",
  "agent_speech_completed",
  "question_asked",
  "question_repeated",
  "soft_reprompted",
  "followup_asked",
  "candidate_speech_started",
  "candidate_speech_stopped",
  "candidate_turn_detected",
  "candidate_turn_started",
  "candidate_turn_finalized",
  "answer_evaluated",
  "silence_timeout_started",
  "wait_requested",
  "question_completed",
  "session_closing",
]);

const terminalStatuses = new Set<RoomStatus>([
  "closing",
  "completed",
  "failed",
]);
