import { liveInterviewWireEventSchema } from "@prelude/contracts";
import { prisma, type Prisma } from "@prelude/db";

import {
  type CandidateRecording,
  getRecordingPlayback,
} from "./recording-playback";

export type CandidateEvidenceStatus =
  | "created"
  | "waiting_candidate"
  | "agent_joining"
  | "in_progress"
  | "paused"
  | "completed"
  | "failed"
  | "expired";

export type CandidateTranscriptTurn = {
  endedAt: string | null;
  eventType: string;
  questionId: string | null;
  sequenceNumber: number;
  speaker: "candidate" | "interviewer" | "system";
  startedAt: string;
  text: string;
  turnId: string;
};

export type CandidateQuestionAnswer = {
  candidateTurns: CandidateTranscriptTurn[];
  interviewerTurns: CandidateTranscriptTurn[];
  questionId: string | null;
};

export type CandidateSessionEvidence = {
  completedAt: string | null;
  eventCount: number;
  failedAt: string | null;
  questionAnswerSequence: CandidateQuestionAnswer[];
  questionCompletionRate: number | null;
  realtimeSessionId: string | null;
  recording: CandidateRecording | null;
  runtimeStatus: string | null;
  status: CandidateEvidenceStatus;
  terminalEventType: "session_completed" | "session_failed" | null;
  transcriptTurns: CandidateTranscriptTurn[];
};

export type StoredLiveEvent = {
  actor: string;
  candidateId: string;
  id: string;
  idempotencyKey: string;
  occurredAt: Date;
  payload: Prisma.JsonValue;
  providerMetadata: Prisma.JsonValue;
  sequenceNumber: number;
  sessionId: string;
  type: string;
};

type ProductSessionEvidenceInput = {
  completedAt: Date | null;
  realtimeSessionId: string | null;
  status: string;
  updatedAt: Date;
};

type RuntimeSessionEvidenceInput = {
  id: string;
  status: string;
  updatedAt: Date;
} | null;

export async function getCandidateSessionEvidence({
  productSession,
  questionCount,
}: {
  productSession: ProductSessionEvidenceInput;
  questionCount: number;
}): Promise<CandidateSessionEvidence> {
  if (!productSession.realtimeSessionId) {
    return buildCandidateSessionEvidence({
      events: [],
      productSession,
      questionCount,
      runtimeSession: null,
    });
  }

  const [runtimeSession, recording] = await Promise.all([
    prisma.liveInterviewSession.findUnique({
      include: {
        events: {
          orderBy: { sequenceNumber: "asc" },
        },
      },
      where: { id: productSession.realtimeSessionId },
    }),
    getRecordingPlayback(productSession.realtimeSessionId),
  ]);

  return {
    ...buildCandidateSessionEvidence({
      events: runtimeSession?.events ?? [],
      productSession,
      questionCount,
      runtimeSession: runtimeSession
        ? {
            id: runtimeSession.id,
            status: runtimeSession.status,
            updatedAt: runtimeSession.updatedAt,
          }
        : null,
    }),
    recording,
  };
}

export function buildCandidateSessionEvidence({
  events,
  productSession,
  questionCount,
  runtimeSession,
}: {
  events: StoredLiveEvent[];
  productSession: ProductSessionEvidenceInput;
  questionCount: number;
  runtimeSession: RuntimeSessionEvidenceInput;
}): CandidateSessionEvidence {
  const parsedEvents = events
    .map((event) => parseStoredEvent(event))
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const transcriptTurns = parsedEvents
    .map((event) => transcriptTurnFromEvent(event))
    .filter((turn): turn is CandidateTranscriptTurn => Boolean(turn));
  const completedEvent = [...parsedEvents]
    .reverse()
    .find((event) => event.type === "session_completed");
  const failedEvent = [...parsedEvents]
    .reverse()
    .find((event) => event.type === "session_failed");
  const terminalEvent = latestTerminalEvent(completedEvent, failedEvent);
  const terminalEventType = toTerminalEventType(terminalEvent?.type);
  const completedAt =
    terminalEventType === "session_completed"
      ? (terminalEvent?.occurredAt ?? null)
      : runtimeSession?.status === "completed"
        ? runtimeSession.updatedAt.toISOString()
        : (productSession.completedAt?.toISOString() ?? null);
  const failedAt =
    terminalEventType === "session_failed"
      ? (terminalEvent?.occurredAt ?? null)
      : runtimeSession?.status === "failed"
        ? runtimeSession.updatedAt.toISOString()
        : null;
  const questionCompletedCount = parsedEvents.filter(
    (event) => event.type === "question_completed",
  ).length;

  return {
    completedAt,
    eventCount: events.length,
    failedAt,
    questionAnswerSequence: buildQuestionAnswerSequence(transcriptTurns),
    questionCompletionRate:
      questionCount > 0
        ? Math.round((questionCompletedCount / questionCount) * 100)
        : null,
    realtimeSessionId: productSession.realtimeSessionId,
    recording: null,
    runtimeStatus: runtimeSession?.status ?? null,
    status: resolveEvidenceStatus({
      productStatus: productSession.status,
      runtimeStatus: runtimeSession?.status,
      terminalEventType,
    }),
    terminalEventType,
    transcriptTurns,
  };
}

export function transcriptTurnFromPayload(
  payload: unknown,
): CandidateTranscriptTurnPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const transcriptTurn = payload.transcriptTurn ?? payload.transcript_turn;
  if (!isRecord(transcriptTurn)) {
    return null;
  }

  const turnId = readString(transcriptTurn.turnId ?? transcriptTurn.turn_id);
  const speaker = readString(transcriptTurn.speaker);
  const text = readString(transcriptTurn.text);
  const startedAt = readString(
    transcriptTurn.startedAt ?? transcriptTurn.started_at,
  );

  if (!turnId || !isTranscriptSpeaker(speaker) || !text || !startedAt) {
    return null;
  }

  return {
    endedAt:
      readString(transcriptTurn.endedAt ?? transcriptTurn.ended_at) ?? null,
    questionId:
      readString(transcriptTurn.questionId ?? transcriptTurn.question_id) ??
      null,
    speaker,
    startedAt,
    text,
    turnId,
  };
}

export function payloadHasTranscriptTurn(payload: unknown) {
  return Boolean(transcriptTurnFromPayload(payload));
}

type CandidateTranscriptTurnPayload = Omit<
  CandidateTranscriptTurn,
  "eventType" | "sequenceNumber"
>;

type ParsedStoredEvent = {
  occurredAt: string;
  payload: unknown;
  sequenceNumber: number;
  type: string;
};

function parseStoredEvent(event: StoredLiveEvent): ParsedStoredEvent | null {
  const parsed = liveInterviewWireEventSchema.safeParse({
    actor: event.actor,
    candidate_id: event.candidateId,
    event_id: event.id,
    idempotency_key: event.idempotencyKey,
    occurred_at: event.occurredAt.toISOString(),
    payload: event.payload,
    provider_metadata: event.providerMetadata,
    sequence_number: event.sequenceNumber,
    session_id: event.sessionId,
    type: event.type,
  });

  if (!parsed.success) {
    return null;
  }

  return {
    occurredAt: parsed.data.occurredAt,
    payload: parsed.data.payload,
    sequenceNumber: parsed.data.sequenceNumber,
    type: parsed.data.type,
  };
}

function transcriptTurnFromEvent(
  event: ParsedStoredEvent,
): CandidateTranscriptTurn | null {
  const transcriptTurn = transcriptTurnFromPayload(event.payload);

  if (!transcriptTurn) {
    return null;
  }

  return {
    ...transcriptTurn,
    eventType: event.type,
    sequenceNumber: event.sequenceNumber,
  };
}

function buildQuestionAnswerSequence(
  transcriptTurns: CandidateTranscriptTurn[],
): CandidateQuestionAnswer[] {
  const sequence: CandidateQuestionAnswer[] = [];

  for (const turn of transcriptTurns) {
    const questionId = turn.questionId;
    const existing =
      (questionId
        ? sequence.find((item) => item.questionId === questionId)
        : null) ?? null;
    const item = existing ?? {
      candidateTurns: [],
      interviewerTurns: [],
      questionId,
    };

    if (!existing) {
      sequence.push(item);
    }

    if (turn.speaker === "candidate") {
      item.candidateTurns.push(turn);
    } else {
      item.interviewerTurns.push(turn);
    }
  }

  return sequence;
}

function latestTerminalEvent(
  completedEvent?: ParsedStoredEvent,
  failedEvent?: ParsedStoredEvent,
) {
  if (!completedEvent) {
    return failedEvent;
  }

  if (!failedEvent) {
    return completedEvent;
  }

  return failedEvent.sequenceNumber > completedEvent.sequenceNumber
    ? failedEvent
    : completedEvent;
}

function toTerminalEventType(
  value: string | undefined,
): "session_completed" | "session_failed" | null {
  if (value === "session_completed" || value === "session_failed") {
    return value;
  }

  return null;
}

function resolveEvidenceStatus({
  productStatus,
  runtimeStatus,
  terminalEventType,
}: {
  productStatus: string;
  runtimeStatus?: string;
  terminalEventType: "session_completed" | "session_failed" | null;
}): CandidateEvidenceStatus {
  if (terminalEventType === "session_completed") {
    return "completed";
  }

  if (terminalEventType === "session_failed") {
    return "failed";
  }

  if (isEvidenceStatus(runtimeStatus)) {
    return runtimeStatus;
  }

  if (isEvidenceStatus(productStatus)) {
    return productStatus;
  }

  return "created";
}

function isEvidenceStatus(value: unknown): value is CandidateEvidenceStatus {
  return (
    value === "created" ||
    value === "waiting_candidate" ||
    value === "agent_joining" ||
    value === "in_progress" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "expired"
  );
}

function isTranscriptSpeaker(
  value: string | null,
): value is CandidateTranscriptTurn["speaker"] {
  return value === "candidate" || value === "interviewer" || value === "system";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
