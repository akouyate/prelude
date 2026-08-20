import { NextResponse } from "next/server";

import {
  prepareCandidateExperiencePreviewSession,
  releaseCandidateExperiencePreviewReservation,
} from "../../../src/server/candidate-experience-previews";
import { provisionRealtimeSession } from "../../../src/server/realtime-session-provisioning";
import { confirmMarketingDemoProvisioning } from "../../../src/server/marketing-demo-admission";
import {
  MarketingDemoRequestError,
  readSizeLimitedJson,
} from "../../../src/server/marketing-demo-security";

export async function POST(request: Request) {
  let input: { consentAccepted: boolean; previewToken: string };
  try {
    const parsed = parsePreviewStart(await readSizeLimitedJson(request));
    if (!parsed) {
      return NextResponse.json(
        { error: { code: "invalid_preview_request" } },
        { status: 400 },
      );
    }
    input = parsed;
  } catch (error) {
    const status =
      error instanceof MarketingDemoRequestError ? error.status : 400;
    return NextResponse.json(
      {
        error: {
          code:
            error instanceof MarketingDemoRequestError
              ? error.code
              : "invalid_preview_request",
        },
      },
      { status },
    );
  }

  const prepared = await prepareCandidateExperiencePreviewSession({
    consentAccepted: input.consentAccepted,
    previewToken: input.previewToken,
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
    expiresAt: prepared.expiresAt,
    interviewPlanId: prepared.interviewPlanId,
    kind: "preview",
  });
  if (!provisioned.ok) {
    const marketingDemoReservation =
      "kind" in prepared.reservation &&
      prepared.reservation.kind === "marketing_demo";
    // A transport/API failure cannot prove that the realtime service did not
    // create a usable room before the response was lost. Marketing demos keep
    // the consumed start and cap lease in that ambiguous case; recruiter
    // previews retain their established retry behavior.
    if (!marketingDemoReservation) {
      await releaseCandidateExperiencePreviewReservation(
        prepared.reservation,
      ).catch((error: unknown) => {
        console.error(
          "[candidate-preview] Failed to release realtime reservation.",
          error,
        );
      });
    }
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
  if (
    "kind" in prepared.reservation &&
    prepared.reservation.kind === "marketing_demo"
  ) {
    try {
      await confirmMarketingDemoProvisioning({
        previewId: prepared.reservation.previewId,
        realtimeSessionId: payload.session.id,
        runtimeExpiresAt: prepared.reservation.runtimeExpiresAt,
      });
    } catch {
      return NextResponse.json(
        { error: { code: "demo_session_confirmation_failed" } },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    allowedModalities: payload.session.allowed_modalities,
    livekit: {
      expiresAt: payload.livekit_join.expires_at,
      isMock,
      participant: payload.livekit_join.participant,
      roomName: payload.livekit_join.room_name,
      token: payload.livekit_join.token,
      url: payload.livekit_join.url,
    },
    productSessionId: null,
    resumeToken: null,
    sessionId: payload.session.id,
    status: payload.session.status,
  });
}

function parsePreviewStart(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => key !== "consentAccepted" && key !== "previewToken",
    ) ||
    typeof body.consentAccepted !== "boolean" ||
    typeof body.previewToken !== "string"
  ) {
    return null;
  }
  const previewToken = body.previewToken.trim();
  if (previewToken.length < 16 || previewToken.length > 160) {
    return null;
  }
  return { consentAccepted: body.consentAccepted, previewToken };
}
