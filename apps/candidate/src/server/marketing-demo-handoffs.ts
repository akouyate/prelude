import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  candidateExperiencePreviewSnapshotSchema,
  type MarketingDemoPostInterviewQuestion,
} from "@prelude/contracts";
import { prisma } from "@prelude/db";

import { realtimeAuthHeaders } from "./realtime-api";
import {
  MarketingDemoRequestError,
  digestOpaqueSecret,
  isAllowedMarketingDemoReturnTarget,
  marketingDemoHandoffEncryptionKey,
  marketingDemoPolicy,
} from "./marketing-demo-security";

const realtimeApiUrl =
  process.env.PRELUDE_REALTIME_API_URL ?? "http://127.0.0.1:8080";

type SubmittedAnswer = { questionId: string; value: number | string };

type MarketingDemoHandoffPayload = {
  answers: SubmittedAnswer[];
  roleSlug: string;
  roleTitle: string;
  transcript: Array<{
    speaker: "candidate" | "interviewer";
    text: string;
  }>;
};

export async function createMarketingDemoHandoff(
  input: {
    answers: SubmittedAnswer[];
    previewToken: string;
    sessionId: string;
  },
  now = new Date(),
) {
  const preview = await prisma.candidateExperiencePreview.findUnique({
    where: { tokenDigest: digestOpaqueSecret(input.previewToken) },
  });
  const parsed = candidateExperiencePreviewSnapshotSchema.safeParse(
    preview?.snapshot,
  );
  if (
    !preview ||
    !parsed.success ||
    parsed.data.schemaVersion !== 2 ||
    parsed.data.variant !== "marketing_demo" ||
    preview.realtimeSessionId !== input.sessionId ||
    preview.runtimeExpiresAt === null ||
    preview.runtimeExpiresAt <= now
  ) {
    throw new MarketingDemoRequestError("demo_handoff_not_found", 404);
  }

  const session = await prisma.liveInterviewSession.findFirst({
    select: { id: true, status: true },
    where: {
      id: input.sessionId,
      interviewPlanId: preview.id,
      kind: "preview",
    },
  });
  if (!session || session.status !== "completed") {
    throw new MarketingDemoRequestError("demo_not_completed", 409);
  }

  const answers = validatePostInterviewAnswers(
    parsed.data.marketingDemo.postInterviewQuestions,
    input.answers,
  );
  const transcript = await fetchFinalTranscript(input.sessionId);
  const payload: MarketingDemoHandoffPayload = {
    answers,
    roleSlug: parsed.data.marketingDemo.roleSlug,
    roleTitle: parsed.data.plan.roleTitle,
    transcript,
  };
  const code = `mdho_${randomBytes(32).toString("base64url")}`;
  const handoffId = `mdh_${randomBytes(18).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + marketingDemoPolicy.handoffTtlMs);

  try {
    await prisma.marketingDemoHandoff.create({
      data: {
        codeDigest: digestOpaqueSecret(code),
        encryptedPayload: encryptHandoffPayload(payload),
        expiresAt,
        id: handoffId,
        previewId: preview.id,
        returnTarget: parsed.data.marketingDemo.returnTarget,
      },
    });
  } catch {
    throw new MarketingDemoRequestError("demo_handoff_unavailable", 503);
  }

  // The relay is durable before erasure begins, but it is not exposed unless
  // realtime confirms the transcript events were deleted. A failed erasure
  // removes the relay again so the browser can retry without creating replays.
  const erased = await eraseRealtimePersonalData(input.sessionId);
  if (!erased) {
    await prisma.marketingDemoHandoff.deleteMany({ where: { id: handoffId } });
    throw new MarketingDemoRequestError("demo_cleanup_unavailable", 503);
  }

  try {
    const completed = await prisma.candidateExperiencePreview.updateMany({
      data: { completedAt: now, runtimeExpiresAt: expiresAt },
      where: { id: preview.id, realtimeSessionId: input.sessionId },
    });
    if (completed.count !== 1) {
      throw new Error("marketing demo preview completion was not persisted");
    }
  } catch {
    await prisma.marketingDemoHandoff.deleteMany({ where: { id: handoffId } });
    throw new MarketingDemoRequestError("demo_handoff_unavailable", 503);
  }

  const handoffUrl = new URL(parsed.data.marketingDemo.returnTarget);
  handoffUrl.searchParams.set("handoff", code);
  return { handoffUrl: handoffUrl.toString() };
}

export async function exchangeMarketingDemoHandoff(
  input: {
    code: string;
    returnTarget: string;
  },
  now = new Date(),
) {
  const normalizedReturnTarget = new URL(input.returnTarget).toString();
  if (!isAllowedMarketingDemoReturnTarget(normalizedReturnTarget)) {
    throw new MarketingDemoRequestError("invalid_return_target", 400);
  }

  const codeDigest = digestOpaqueSecret(input.code);
  const relay = await prisma.marketingDemoHandoff.findUnique({
    where: { codeDigest },
  });
  if (
    !relay ||
    relay.expiresAt <= now ||
    relay.returnTarget !== normalizedReturnTarget
  ) {
    throw new MarketingDemoRequestError("handoff_not_found", 404);
  }

  let payload: MarketingDemoHandoffPayload;
  try {
    payload = decryptHandoffPayload(relay.encryptedPayload);
  } catch {
    await prisma.marketingDemoHandoff.deleteMany({ where: { id: relay.id } });
    throw new MarketingDemoRequestError("handoff_not_found", 404);
  }

  const consumed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.marketingDemoHandoff.deleteMany({
      where: {
        codeDigest,
        expiresAt: { gt: now },
        returnTarget: normalizedReturnTarget,
      },
    });
    if (deleted.count !== 1) {
      return false;
    }

    const sessions = await tx.liveInterviewSession.findMany({
      select: { id: true },
      where: {
        interviewPlanId: relay.previewId,
        kind: "preview",
        recordings: { none: {} },
      },
    });
    if (sessions.length > 0) {
      await tx.liveInterviewSession.deleteMany({
        where: { id: { in: sessions.map((session) => session.id) } },
      });
    }
    await tx.candidateExperiencePreview.deleteMany({
      where: { id: relay.previewId },
    });
    return true;
  });
  if (!consumed) {
    throw new MarketingDemoRequestError("handoff_not_found", 404);
  }

  return payload;
}

function validatePostInterviewAnswers(
  questions: MarketingDemoPostInterviewQuestion[],
  submitted: SubmittedAnswer[],
) {
  const submittedById = new Map<string, SubmittedAnswer>();
  for (const answer of submitted) {
    if (submittedById.has(answer.questionId)) {
      throw new MarketingDemoRequestError("invalid_demo_answers", 400);
    }
    submittedById.set(answer.questionId, answer);
  }
  if (
    [...submittedById.keys()].some((id) => !questions.some((q) => q.id === id))
  ) {
    throw new MarketingDemoRequestError("invalid_demo_answers", 400);
  }

  const validated: SubmittedAnswer[] = [];
  for (const question of questions) {
    const answer = submittedById.get(question.id);
    if (!answer) {
      if (question.required) {
        throw new MarketingDemoRequestError("invalid_demo_answers", 400);
      }
      continue;
    }

    switch (question.type) {
      case "short_text": {
        if (
          typeof answer.value !== "string" ||
          answer.value.trim().length > question.maxLength ||
          (question.required && answer.value.trim().length === 0)
        ) {
          throw new MarketingDemoRequestError("invalid_demo_answers", 400);
        }
        if (answer.value.trim().length > 0) {
          validated.push({
            questionId: question.id,
            value: answer.value.trim(),
          });
        }
        break;
      }
      case "single_select": {
        if (
          typeof answer.value !== "string" ||
          !question.options.some((option) => option.value === answer.value)
        ) {
          throw new MarketingDemoRequestError("invalid_demo_answers", 400);
        }
        validated.push({ questionId: question.id, value: answer.value });
        break;
      }
      case "scale": {
        if (
          typeof answer.value !== "number" ||
          !Number.isInteger(answer.value) ||
          answer.value < question.min ||
          answer.value > question.max
        ) {
          throw new MarketingDemoRequestError("invalid_demo_answers", 400);
        }
        validated.push({ questionId: question.id, value: answer.value });
        break;
      }
    }
  }
  return validated;
}

async function fetchFinalTranscript(sessionId: string) {
  const response = await fetch(
    `${realtimeApiUrl}/v1/interview-sessions/${encodeURIComponent(sessionId)}/transcript`,
    {
      cache: "no-store",
      headers: { accept: "application/json", ...realtimeAuthHeaders() },
    },
  ).catch(() => null);
  if (!response?.ok) {
    throw new MarketingDemoRequestError("demo_transcript_unavailable", 503);
  }
  const body = (await response.json().catch(() => null)) as {
    transcript?: unknown;
  } | null;
  if (!Array.isArray(body?.transcript)) {
    throw new MarketingDemoRequestError("demo_transcript_unavailable", 503);
  }

  const byId = new Map<
    string,
    { speaker: "candidate" | "interviewer"; text: string }
  >();
  for (const value of body.transcript.slice(0, 200)) {
    if (!isRecord(value)) {
      continue;
    }
    const turnId = readString(value.turn_id ?? value.turnId);
    const speaker = value.speaker;
    const text = readString(value.text)?.slice(0, 4000);
    const isFinal = value.is_final ?? value.isFinal;
    if (
      turnId &&
      text &&
      isFinal !== false &&
      (speaker === "candidate" || speaker === "interviewer")
    ) {
      byId.set(turnId, { speaker, text });
    }
  }
  if (byId.size === 0) {
    throw new MarketingDemoRequestError("demo_transcript_unavailable", 503);
  }
  return [...byId.values()];
}

async function eraseRealtimePersonalData(sessionId: string) {
  const response = await fetch(
    `${realtimeApiUrl}/v1/interview-sessions/${encodeURIComponent(sessionId)}/personal-data`,
    {
      cache: "no-store",
      headers: realtimeAuthHeaders(),
      method: "DELETE",
    },
  ).catch(() => null);
  return Boolean(response?.ok);
}

function encryptHandoffPayload(payload: MarketingDemoHandoffPayload) {
  const key = marketingDemoHandoffEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((value) => value.toString("base64url"))
    .join(".");
}

function decryptHandoffPayload(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid encrypted payload");
  }
  const [ivPart, tagPart, ciphertextPart] = parts as [string, string, string];
  const decipher = createDecipheriv(
    "aes-256-gcm",
    marketingDemoHandoffEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as MarketingDemoHandoffPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
