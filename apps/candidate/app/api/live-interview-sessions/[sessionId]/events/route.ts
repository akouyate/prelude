import { NextResponse } from "next/server";

const REALTIME_API_URL =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

type RealtimeEvent = {
  event_id?: unknown;
  eventId?: unknown;
  sequence_number?: unknown;
  sequence?: unknown;
  type: string;
  actor?: unknown;
  occurred_at?: unknown;
  occurredAt?: unknown;
  payload?: unknown;
};

type RealtimeSessionPayload = {
  session?: {
    id: string;
    candidate_id: string;
    status?: string;
    events?: RealtimeEvent[];
  };
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const supportedCandidateEventTypes = new Set([
  "candidate_joined",
  "candidate_media_ready",
]);

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const sessionResponse = await fetch(
    `${REALTIME_API_URL}/v1/interview-sessions/${sessionId}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  ).catch(() => null);

  if (!sessionResponse?.ok) {
    return NextResponse.json(
      { error: { code: "session_unavailable" } },
      { status: 502 },
    );
  }

  const payload = (await sessionResponse.json()) as RealtimeSessionPayload;
  const session = payload.session;
  if (!session) {
    return NextResponse.json(
      { error: { code: "session_unavailable" } },
      { status: 502 },
    );
  }

  return NextResponse.json({
    session: {
      sessionId: session.id,
      status: session.status ?? "unknown",
      events: (session.events ?? [])
        .map(normalizeRealtimeEvent)
        .filter((event) => event !== null),
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    type?: string;
    payload?: Record<string, unknown>;
  } | null;

  const eventType = body?.type;
  if (!eventType || !supportedCandidateEventTypes.has(eventType)) {
    return NextResponse.json(
      { error: { code: "unsupported_event_type" } },
      { status: 400 },
    );
  }

  const sessionResponse = await fetch(
    `${REALTIME_API_URL}/v1/interview-sessions/${sessionId}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  ).catch(() => null);

  if (!sessionResponse?.ok) {
    return NextResponse.json(
      { error: { code: "session_unavailable" } },
      { status: 502 },
    );
  }

  const sessionPayload =
    (await sessionResponse.json()) as RealtimeSessionPayload;
  const session = sessionPayload.session;
  if (!session) {
    return NextResponse.json(
      { error: { code: "session_unavailable" } },
      { status: 502 },
    );
  }

  const events = session.events ?? [];
  if (events.some((event) => event.type === eventType)) {
    return NextResponse.json({ duplicate: true });
  }
  if (
    eventType === "candidate_media_ready" &&
    !events.some((event) => event.type === "candidate_joined")
  ) {
    return NextResponse.json(
      { error: { code: "candidate_not_joined" } },
      { status: 409 },
    );
  }

  const eventResponse = await fetch(
    `${REALTIME_API_URL}/v1/interview-sessions/${sessionId}/events`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: `evt_${sessionId}_${eventType}`,
        session_id: sessionId,
        candidate_id: session.candidate_id,
        type: eventType,
        actor: "candidate",
        sequence_number: events.length + 1,
        idempotency_key: `${sessionId}:${eventType}`,
        payload: body.payload ?? {},
      }),
      cache: "no-store",
    },
  ).catch(() => null);

  if (!eventResponse?.ok) {
    return NextResponse.json(
      { error: { code: "event_ingest_failed" } },
      { status: 502 },
    );
  }

  return NextResponse.json({ duplicate: false });
}

function normalizeRealtimeEvent(event: RealtimeEvent) {
  const type = readString(event.type);
  if (!type) {
    return null;
  }

  return {
    eventId:
      readString(event.event_id ?? event.eventId) ??
      `event_${readNumber(event.sequence_number ?? event.sequence) ?? 0}_${type}`,
    sequence: readNumber(event.sequence_number ?? event.sequence) ?? 0,
    type,
    actor: readString(event.actor) ?? "system",
    occurredAt: readString(event.occurred_at ?? event.occurredAt) ?? "",
    payload:
      event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload
        : {},
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
