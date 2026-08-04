import { realtimeAuthHeaders } from "./realtime-api";

const REALTIME_API_URL =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

export type RealtimeSessionResponse = {
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

export async function provisionRealtimeSession(input: {
  allowedModalities: readonly string[];
  candidateId: string;
  expiresAt?: Date | null;
  interviewPlanId: string;
  kind?: "candidate" | "preview";
}) {
  let response: Response;
  try {
    response = await fetch(`${REALTIME_API_URL}/v1/interview-sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...realtimeAuthHeaders(),
      },
      body: JSON.stringify({
        allowed_modalities: input.allowedModalities,
        candidate_id: input.candidateId,
        expires_at: input.expiresAt?.toISOString() ?? null,
        interview_plan_id: input.interviewPlanId,
        session_kind: input.kind ?? "candidate",
      }),
      cache: "no-store",
    });
  } catch {
    return {
      code: "realtime_api_unavailable" as const,
      ok: false as const,
      status: 502,
    };
  }

  if (!response.ok) {
    return {
      code: "realtime_api_failed" as const,
      ok: false as const,
      realtimeStatus: response.status,
      status: 502,
    };
  }

  const payload = await response.json().catch(() => null);
  if (!isRealtimeSessionResponse(payload)) {
    return {
      code: "realtime_api_invalid_response" as const,
      ok: false as const,
      status: 502,
    };
  }

  const isMock = payload.livekit_join.token.startsWith("mock_lk_");
  if (isMock && !mockInterviewAllowed()) {
    console.error(
      "[live-interview] Refusing a mock LiveKit token outside an explicitly mock-enabled, non-production environment.",
    );
    return {
      code: "mock_interview_refused" as const,
      message:
        "The live interview service is not available right now. Please try again later.",
      ok: false as const,
      status: 502,
    };
  }

  return { isMock, ok: true as const, payload };
}

function mockInterviewAllowed(): boolean {
  if (process.env.APP_ENV === "production") {
    return false;
  }
  const flag = (process.env.ALLOW_MOCK_INTERVIEW ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
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
