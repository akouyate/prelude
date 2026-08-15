import { NextResponse } from "next/server";
import { prisma } from "@prelude/db";

import { settleCandidateSessionCredit } from "../../../src/server/credit-settlement";
import {
  prepareCandidateSession,
  toProductCandidateLifecycleStatus,
} from "../../../src/server/public-interviews";
import { provisionRealtimeSession } from "../../../src/server/realtime-session-provisioning";

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

  const provisioned = await provisionRealtimeSession({
    allowedModalities: prepared.allowedModalities,
    candidateId: prepared.candidateId,
    interviewPlanId: prepared.interviewPlanId,
  });
  if (!provisioned.ok) {
    await markProvisioningFailed(prepared);
    return NextResponse.json(
      {
        error: {
          code: provisioned.code,
          ...(provisioned.message ? { message: provisioned.message } : {}),
          ...(provisioned.realtimeStatus
            ? { status: provisioned.realtimeStatus }
            : {}),
        },
      },
      { status: provisioned.status },
    );
  }
  const { isMock, payload } = provisioned;

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

  if (prepared.supersededSessionId) {
    await prisma.candidateSession.update({
      data: { status: "superseded" },
      where: { id: prepared.supersededSessionId },
    });
    await settleCandidateSessionCredit(prisma, {
      kind: "superseded",
      now: new Date(),
      sessionId: prepared.supersededSessionId,
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
    // This is a terminal write that bypasses `markCandidateSessionLifecycle`, so
    // it has to settle for itself: the credit was reserved at admission a few
    // lines earlier and the room never came up, which is nobody's interview.
    await settleCandidateSessionCredit(prisma, {
      kind: "failed",
      now: new Date(),
      sessionId: prepared.productSession.id,
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
