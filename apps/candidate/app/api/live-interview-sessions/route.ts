import { NextResponse } from "next/server";
import { prisma } from "@prelude/db";

import { prepareCandidateSession } from "../../../src/server/public-interviews";

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
    candidateEmail?: string;
    candidateName?: string;
    candidateToken?: string;
    consentAccepted?: boolean;
    resumeToken?: string;
    videoEnabled?: boolean;
  } | null;

  const candidateToken = body?.candidateToken?.trim();
  if (!candidateToken || candidateToken.length < 4) {
    return NextResponse.json(
      { error: { code: "invalid_candidate_token" } },
      { status: 400 },
    );
  }

  const prepared = await prepareCandidateSession({
    candidateEmail: body?.candidateEmail,
    candidateName: body?.candidateName,
    candidateToken,
    consentAccepted: Boolean(body?.consentAccepted),
    resumeToken: body?.resumeToken,
    videoEnabled: body?.videoEnabled,
  });
  if (!prepared.ok) {
    return NextResponse.json(
      { error: { code: prepared.error } },
      { status: prepared.status },
    );
  }

  let realtimeResponse: Response;
  try {
    realtimeResponse = await fetch(
      `${REALTIME_API_URL}/v1/interview-sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interview_plan_id: prepared.interviewPlanId,
          candidate_id: prepared.candidateId,
          allowed_modalities: prepared.allowedModalities,
        }),
        cache: "no-store",
      },
    );
  } catch {
    if (prepared.productSession) {
      await prisma.candidateSession.update({
        data: { status: "failed" },
        where: { id: prepared.productSession.id },
      });
    }

    return NextResponse.json(
      { error: { code: "realtime_api_unavailable" } },
      { status: 502 },
    );
  }

  if (!realtimeResponse.ok) {
    if (prepared.productSession) {
      await prisma.candidateSession.update({
        data: { status: "failed" },
        where: { id: prepared.productSession.id },
      });
    }

    return NextResponse.json(
      {
        error: {
          code: "realtime_api_failed",
          status: realtimeResponse.status,
        },
      },
      { status: 502 },
    );
  }

  const payload = (await realtimeResponse.json()) as RealtimeSessionResponse;

  if (prepared.productSession) {
    await prisma.candidateSession.update({
      data: {
        realtimeSessionId: payload.session.id,
        status: payload.session.status,
      },
      where: { id: prepared.productSession.id },
    });
  }

  return NextResponse.json({
    sessionId: payload.session.id,
    productSessionId: prepared.productSession?.id ?? null,
    resumeToken: prepared.resumeToken,
    status: payload.session.status,
    allowedModalities: payload.session.allowed_modalities,
    livekit: {
      roomName: payload.livekit_join.room_name,
      url: payload.livekit_join.url,
      token: payload.livekit_join.token,
      participant: payload.livekit_join.participant,
      expiresAt: payload.livekit_join.expires_at,
      isMock: payload.livekit_join.token.startsWith("mock_lk_"),
    },
  });
}
