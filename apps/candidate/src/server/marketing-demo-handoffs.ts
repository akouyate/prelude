import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  candidateExperiencePreviewSnapshotSchema,
  marketingDemoHandoffResponseSchema,
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

type MarketingDemoHandoffPayload = ReturnType<
  typeof marketingDemoHandoffResponseSchema.parse
>;

export async function createMarketingDemoHandoff(
  input: {
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

  const payload: MarketingDemoHandoffPayload = {
    completed: true,
    roleSlug: parsed.data.marketingDemo.roleSlug,
    roleTitle: parsed.data.plan.roleTitle,
    roleVersion: parsed.data.marketingDemo.roleVersion,
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
    payload = marketingDemoHandoffResponseSchema.parse(
      decryptHandoffPayload(relay.encryptedPayload),
    );
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
  return JSON.parse(plaintext) as unknown;
}
