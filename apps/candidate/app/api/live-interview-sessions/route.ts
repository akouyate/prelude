import { NextResponse } from "next/server";
import { prisma } from "@prelude/db";

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

  const publishedInterview = await resolvePublishedInterview(candidateToken);
  const allowedModalities = publishedInterview
    ? resolveAllowedModalities(publishedInterview.responseModes, body?.videoEnabled)
    : body?.videoEnabled === false
      ? ["audio"]
      : ["audio", "video"];
  const candidateSession = publishedInterview
    ? await prisma.candidateSession.create({
        data: {
          interviewId: publishedInterview.id,
          organizationId: publishedInterview.organizationId,
          startedAt: new Date(),
          status: "started"
        },
      })
    : null;

  let realtimeResponse: Response;
  try {
    realtimeResponse = await fetch(`${REALTIME_API_URL}/v1/interview-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        interview_plan_id: publishedInterview?.id ?? "plan-demo-product-manager",
        candidate_id:
          candidateSession?.id ??
          `candidate-${candidateToken.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        allowed_modalities: allowedModalities
      }),
      cache: "no-store"
    });
  } catch {
    if (candidateSession) {
      await prisma.candidateSession.update({
        data: { status: "failed" },
        where: { id: candidateSession.id },
      });
    }

    return NextResponse.json(
      { error: { code: "realtime_api_unavailable" } },
      { status: 502 }
    );
  }

  if (!realtimeResponse.ok) {
    if (candidateSession) {
      await prisma.candidateSession.update({
        data: { status: "failed" },
        where: { id: candidateSession.id },
      });
    }

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

  if (candidateSession) {
    await prisma.candidateSession.update({
      data: {
        realtimeSessionId: payload.session.id,
        status: payload.session.status,
      },
      where: { id: candidateSession.id },
    });
  }

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

async function resolvePublishedInterview(candidateToken: string) {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return prisma.interview.findFirst({
    select: {
      id: true,
      organizationId: true,
      responseModes: true,
    },
    where: {
      publicToken: candidateToken,
      status: "published",
    },
  });
}

function resolveAllowedModalities(value: unknown, videoEnabled = true) {
  const modes = Array.isArray(value)
    ? value.filter((mode): mode is string => typeof mode === "string")
    : [];
  const allowed = new Set<string>();

  if (modes.includes("text")) {
    allowed.add("form");
  }

  if (modes.includes("audio") || modes.length === 0) {
    allowed.add("audio");
  }

  if (videoEnabled && modes.includes("video")) {
    allowed.add("video");
  }

  if (allowed.size === 0) {
    allowed.add("audio");
  }

  return [...allowed];
}
