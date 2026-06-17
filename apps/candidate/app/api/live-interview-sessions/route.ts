import { NextResponse } from "next/server";

const REALTIME_API_URL =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

type RealtimeSessionResponse = {
  session: {
    id: string;
    status: string;
    livekit_room_name: string;
    allowed_modalities: string[];
  };
  livekit_join: {
    room_name: string;
    url: string;
    token: string;
    participant: string;
    expires_at: string;
  };
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    candidateToken?: string;
    videoEnabled?: boolean;
  } | null;

  const candidateToken = body?.candidateToken?.trim();
  if (!candidateToken || candidateToken.length < 4) {
    return NextResponse.json(
      { error: { code: "invalid_candidate_token" } },
      { status: 400 }
    );
  }

  const allowedModalities = body?.videoEnabled === false ? ["audio"] : ["audio", "video"];

  let realtimeResponse: Response;
  try {
    realtimeResponse = await fetch(`${REALTIME_API_URL}/v1/interview-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        interview_plan_id: "plan-demo-product-manager",
        candidate_id: `candidate-${candidateToken.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        allowed_modalities: allowedModalities
      }),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      { error: { code: "realtime_api_unavailable" } },
      { status: 502 }
    );
  }

  if (!realtimeResponse.ok) {
    return NextResponse.json(
      {
        error: {
          code: "realtime_api_failed",
          status: realtimeResponse.status
        }
      },
      { status: 502 }
    );
  }

  const payload = (await realtimeResponse.json()) as RealtimeSessionResponse;

  return NextResponse.json({
    sessionId: payload.session.id,
    status: payload.session.status,
    allowedModalities: payload.session.allowed_modalities,
    livekit: {
      roomName: payload.livekit_join.room_name,
      url: payload.livekit_join.url,
      token: payload.livekit_join.token,
      participant: payload.livekit_join.participant,
      expiresAt: payload.livekit_join.expires_at,
      isMock: payload.livekit_join.token.startsWith("mock_lk_")
    }
  });
}
