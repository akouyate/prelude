import { NextResponse } from "next/server";

const REALTIME_API_URL =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

type RealtimeEvent = {
  type: string;
};

type RealtimeSessionPayload = {
  session?: {
    id: string;
    candidate_id: string;
    events?: RealtimeEvent[];
  };
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    type?: string;
    payload?: Record<string, unknown>;
  } | null;

  if (body?.type !== "candidate_joined") {
    return NextResponse.json(
      { error: { code: "unsupported_event_type" } },
      { status: 400 }
    );
  }

  const sessionResponse = await fetch(
    `${REALTIME_API_URL}/v1/interview-sessions/${sessionId}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store"
    }
  ).catch(() => null);

  if (!sessionResponse?.ok) {
    return NextResponse.json(
      { error: { code: "session_unavailable" } },
      { status: 502 }
    );
  }

  const sessionPayload = (await sessionResponse.json()) as RealtimeSessionPayload;
  const session = sessionPayload.session;
  if (!session) {
    return NextResponse.json(
      { error: { code: "session_unavailable" } },
      { status: 502 }
    );
  }

  const events = session.events ?? [];
  if (events.some((event) => event.type === "candidate_joined")) {
    return NextResponse.json({ duplicate: true });
  }

  const eventResponse = await fetch(
    `${REALTIME_API_URL}/v1/interview-sessions/${sessionId}/events`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: `evt_${sessionId}_candidate_joined`,
        session_id: sessionId,
        candidate_id: session.candidate_id,
        type: "candidate_joined",
        actor: "candidate",
        sequence_number: events.length + 1,
        idempotency_key: `${sessionId}:candidate_joined`,
        payload: body.payload ?? {}
      }),
      cache: "no-store"
    }
  ).catch(() => null);

  if (!eventResponse?.ok) {
    return NextResponse.json(
      { error: { code: "event_ingest_failed" } },
      { status: 502 }
    );
  }

  return NextResponse.json({ duplicate: false });
}
