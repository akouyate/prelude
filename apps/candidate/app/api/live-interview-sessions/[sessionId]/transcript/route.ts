import { NextResponse } from "next/server";

import { realtimeAuthHeaders } from "../../../../../src/server/realtime-api";

const REALTIME_API_URL =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type RealtimeTranscriptTurn = {
  turn_id?: unknown;
  turnId?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  question_id?: unknown;
  questionId?: unknown;
  speaker?: unknown;
  text?: unknown;
  is_final?: unknown;
  isFinal?: unknown;
  started_at?: unknown;
  startedAt?: unknown;
  ended_at?: unknown;
  endedAt?: unknown;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const response = await fetch(
    `${REALTIME_API_URL}/v1/interview-sessions/${sessionId}/transcript`,
    {
      headers: { accept: "application/json", ...realtimeAuthHeaders() },
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response?.ok) {
    return NextResponse.json(
      { error: { code: "transcript_unavailable" } },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as {
    transcript?: RealtimeTranscriptTurn[];
  };

  const transcript = Array.isArray(payload.transcript)
    ? payload.transcript.map(normalizeTranscriptTurn).filter(Boolean)
    : [];

  return NextResponse.json({ transcript });
}

function normalizeTranscriptTurn(turn: RealtimeTranscriptTurn) {
  const turnId = readString(turn.turn_id ?? turn.turnId);
  const sessionId = readString(turn.session_id ?? turn.sessionId);
  const speaker = readSpeaker(turn.speaker);
  const text = readString(turn.text);
  const startedAt = readString(turn.started_at ?? turn.startedAt);

  if (!turnId || !sessionId || !speaker || !text || !startedAt) {
    return null;
  }

  return {
    turnId,
    sessionId,
    questionId: readString(turn.question_id ?? turn.questionId),
    speaker,
    text,
    isFinal: readBoolean(turn.is_final ?? turn.isFinal),
    startedAt,
    endedAt: readString(turn.ended_at ?? turn.endedAt),
  };
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
