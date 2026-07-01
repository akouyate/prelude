import type {
  LiveSessionEvent,
  LiveSessionState,
  LiveTranscriptTurn,
  RoomStatus,
} from "./live-interview-types";

export function statusFromSessionState(state: LiveSessionState): RoomStatus {
  if (
    state.status === "failed" ||
    hasEventType(state.events, "session_failed")
  ) {
    return "failed";
  }
  if (state.status === "abandoned") {
    return "abandoned";
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
    currentStatus === "failed" ||
    currentStatus === "abandoned"
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
  if (
    currentStatus === "completed" ||
    currentStatus === "failed" ||
    currentStatus === "abandoned"
  ) {
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

// visibleInterviewerTurns is what the candidate live UI renders: only the
// interviewer's finalized questions. The candidate's own speech is hidden (they
// asked to see only the agent's questions), and streaming partials are dropped —
// those arrive as a flurry of short, non-final turns with their own ids and were
// the source of the flicker + duplicated phrases. Sorted by start time with a
// stable turnId tiebreak so equal timestamps never reorder between renders.
export function visibleInterviewerTurns(
  turns: LiveTranscriptTurn[],
): LiveTranscriptTurn[] {
  const sorted = turns
    .filter((turn) => turn.speaker === "interviewer" && turn.isFinal)
    .sort((left, right) => {
      const leftStart = Date.parse(left.startedAt);
      const rightStart = Date.parse(right.startedAt);
      const byStart =
        (Number.isNaN(leftStart) ? 0 : leftStart) -
        (Number.isNaN(rightStart) ? 0 : rightStart);

      return byStart !== 0 ? byStart : left.turnId.localeCompare(right.turnId);
    });

  // Collapse progressive duplicates: the same spoken phrase arrives several times
  // at different lengths — streaming partials that leaked in as final, plus the
  // prelude data packet and the HTTP poll — which showed as stacked, half-written
  // copies of one question. Keep the most complete version. A finished question
  // ends on terminal punctuation, so two genuinely distinct questions are never
  // merged; only an unterminated fragment folds into the longer phrase it
  // prefixes.
  const kept: LiveTranscriptTurn[] = [];
  for (const turn of sorted) {
    const key = normalizeTranscriptText(turn.text);
    const dupIndex = kept.findIndex((other) => {
      const otherKey = normalizeTranscriptText(other.text);
      if (otherKey === key) {
        return true;
      }
      if (otherKey.startsWith(key)) {
        return looksTruncated(key);
      }
      if (key.startsWith(otherKey)) {
        return looksTruncated(otherKey);
      }

      return false;
    });

    if (dupIndex === -1) {
      kept.push(turn);
      continue;
    }

    const existing = kept[dupIndex];
    if (
      existing &&
      normalizeTranscriptText(turn.text).length >
        normalizeTranscriptText(existing.text).length
    ) {
      kept[dupIndex] = turn;
    }
  }

  return kept;
}

// normalizeTranscriptText is the dedupe/identity key for a spoken phrase:
// trimmed, single-spaced, lower-cased — so the same question phrased with
// incidental whitespace or casing differences collapses to one line.
export function normalizeTranscriptText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// looksTruncated marks a phrase that does not end on terminal punctuation — the
// fingerprint of a streaming partial cut mid-sentence, as opposed to a finished
// question. Only such fragments are folded into a longer phrase they prefix, so
// two complete questions are never collapsed into one.
function looksTruncated(normalizedText: string): boolean {
  return !/[.!?…]$/.test(normalizedText.trim());
}

export type InterviewerView = {
  // The big foreground line. null means "nothing said yet" — the caller falls
  // back to a status description.
  activeText: string | null;
  // Identity of the active line, used to re-key the render so a *new* question
  // re-triggers the word reveal while a *growing* one updates in place.
  activeTurnId: string | null;
  // True only while the live caption is still streaming in (voice in progress),
  // which drives the per-word reveal + cursor. False once finalized or when the
  // active line is a finalized fallback (e.g. after a reconnect).
  isStreaming: boolean;
  // Up to the three previous finalized questions, shown dimmed above the active
  // line. Never includes the active line's own (possibly finalized) twin.
  previous: LiveTranscriptTurn[];
};

// selectInterviewerView decides what the candidate's live stage shows. The live
// caption (audio-synced LiveKit transcription) is authoritative for the active
// line so the text tracks the voice word by word; finalized turns are history.
// The same segment also arrives as a finalized turn from other paths (LiveKit
// stream close, the prelude data packet, HTTP polling), so the caption's twin is
// excluded from the dimmed history to avoid showing it twice.
export function selectInterviewerView({
  finalTurns,
  caption,
}: {
  finalTurns: LiveTranscriptTurn[];
  caption: LiveTranscriptTurn | null;
}): InterviewerView {
  const finals = visibleInterviewerTurns(finalTurns);
  const captionText = caption?.text.trim() ?? "";

  if (caption && captionText.length > 0) {
    const captionKey = normalizeTranscriptText(captionText);
    const lastIndex = finals.length - 1;
    const previous = finals.filter((turn, index) => {
      if (turn.turnId === caption.turnId) {
        return false;
      }
      const turnKey = normalizeTranscriptText(turn.text);
      if (turnKey === captionKey) {
        return false;
      }
      // The caption is the live version of the most recent utterance: drop that
      // one turn when they are the same growing phrase (either prefixes the
      // other), but never an older question that merely shares a prefix.
      if (
        index === lastIndex &&
        (turnKey.startsWith(captionKey) || captionKey.startsWith(turnKey))
      ) {
        return false;
      }

      return true;
    });

    return {
      activeText: captionText,
      activeTurnId: caption.turnId,
      isStreaming: !caption.isFinal,
      previous: lastTurns(previous, 3),
    };
  }

  const active = finals.length > 0 ? finals[finals.length - 1] : null;
  return {
    activeText: active?.text ?? null,
    activeTurnId: active?.turnId ?? null,
    isStreaming: false,
    previous: lastTurns(finals.slice(0, -1), 3),
  };
}

function lastTurns(turns: LiveTranscriptTurn[], count: number) {
  return turns.slice(Math.max(0, turns.length - count));
}

export function hasClosingTranscript(state: LiveSessionState) {
  return state.events.some(
    (event) =>
      event.type === "session_closing" &&
      transcriptTurnFromEvent(event) !== null,
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
  if (status === "abandoned") {
    return "abandoned";
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
  "abandoned",
  "closing",
  "completed",
  "failed",
]);
