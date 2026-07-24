import { NextResponse } from "next/server";
import { prisma } from "@prelude/db";

import {
  prepareCandidateSession,
  toProductCandidateLifecycleStatus,
} from "../../../src/server/public-interviews";
import { realtimeAuthHeaders } from "../../../src/server/realtime-api";

const REALTIME_API_URL =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

// Default-deny, and never in production: a real candidate must never silently
// sit through a fake, no-audio (mock) interview. Mock rooms are allowed only in
// an explicitly opted-in, non-production environment for local smoke runs.
function mockInterviewAllowed(): boolean {
  if (process.env.APP_ENV === "production") {
    return false;
  }
  const flag = (process.env.ALLOW_MOCK_INTERVIEW ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

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
        headers: {
          "content-type": "application/json",
          ...realtimeAuthHeaders(),
        },
        body: JSON.stringify({
          interview_plan_id: prepared.interviewPlanId,
          candidate_id: prepared.candidateId,
          allowed_modalities: prepared.allowedModalities,
        }),
        cache: "no-store",
      },
    );
  } catch {
    await markProvisioningFailed(prepared);

    return NextResponse.json(
      { error: { code: "realtime_api_unavailable" } },
      { status: 502 },
    );
  }

  if (!realtimeResponse.ok) {
    await markProvisioningFailed(prepared);

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

  const rawPayload = await realtimeResponse.json().catch(() => null);
  if (!isRealtimeSessionResponse(rawPayload)) {
    await markProvisioningFailed(prepared);
    return NextResponse.json(
      { error: { code: "realtime_api_invalid_response" } },
      { status: 502 },
    );
  }
  const payload = rawPayload;

  if (prepared.productSession) {
    const productStatus = toProductCandidateLifecycleStatus(
      payload.session.status,
    );
    await prisma.candidateSession.update({
      data: {
        realtimeSessionId: payload.session.id,
        status: productStatus,
      },
      where: { id: prepared.productSession.id },
    });
    if (prepared.candidateInvitationId) {
      await prisma.candidateInvitation.updateMany({
        data: { status: productStatus },
        where: {
          id: prepared.candidateInvitationId,
          status: { notIn: ["completed", "expired", "superseded"] },
        },
      });
    }
  }

  const isMock = payload.livekit_join.token.startsWith("mock_lk_");
  if (isMock && !mockInterviewAllowed()) {
    // Refuse loudly instead of silently dropping the candidate into the no-audio
    // form fallback — a fake interview must never reach a real candidate.
    console.error(
      "[live-interview] Refusing a mock LiveKit token (mock_lk_*) outside an explicitly mock-enabled, non-production environment.",
    );
    await markProvisioningFailed(prepared);

    return NextResponse.json(
      {
        error: {
          code: "mock_interview_refused",
          message:
            "The live interview service is not available right now. Please try again later.",
        },
      },
      { status: 502 },
    );
  }

  if (prepared.supersededSessionId) {
    await prisma.candidateSession.update({
      data: { status: "superseded" },
      where: { id: prepared.supersededSessionId },
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
      isMock,
    },
  });
}

type PreparedCandidateSession = Extract<
  Awaited<ReturnType<typeof prepareCandidateSession>>,
  { ok: true }
>;

async function markProvisioningFailed(prepared: PreparedCandidateSession) {
  if (prepared.productSession) {
    await prisma.candidateSession.update({
      data: { status: "failed" },
      where: { id: prepared.productSession.id },
    });
  }
  if (prepared.candidateInvitationId) {
    await prisma.candidateInvitation.updateMany({
      data: { status: "failed" },
      where: {
        id: prepared.candidateInvitationId,
        status: { notIn: ["completed", "expired", "superseded"] },
      },
    });
  }
}

function isRealtimeSessionResponse(
  value: unknown,
): value is RealtimeSessionResponse {
  if (!isRecord(value) || !isRecord(value.session)) {
    return false;
  }
  if (!isRecord(value.livekit_join)) {
    return false;
  }

  return (
    isNonEmptyString(value.session.id) &&
    isNonEmptyString(value.session.status) &&
    isNonEmptyString(value.session.livekit_room_name) &&
    Array.isArray(value.session.allowed_modalities) &&
    value.session.allowed_modalities.every(isNonEmptyString) &&
    isNonEmptyString(value.livekit_join.room_name) &&
    isNonEmptyString(value.livekit_join.url) &&
    isNonEmptyString(value.livekit_join.token) &&
    isNonEmptyString(value.livekit_join.participant) &&
    isNonEmptyString(value.livekit_join.expires_at)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
