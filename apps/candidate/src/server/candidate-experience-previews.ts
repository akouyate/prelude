import { createHash, randomBytes } from "node:crypto";

import { candidateExperiencePreviewSnapshotSchema } from "@prelude/contracts";
import {
  candidatePreviewPolicy,
  candidatePreviewRuntimeExpiresAt,
  isCandidatePreviewActive,
} from "@prelude/core";
import { prisma } from "@prelude/db";

import {
  resolveAllowedModalities,
  type PublicInterviewContext,
} from "./public-interviews";

type ActivePreviewContext = Extract<
  PublicInterviewContext,
  { kind: "preview" }
>;

export async function getCandidateExperiencePreviewContext(
  rawToken: string,
): Promise<PublicInterviewContext> {
  const token = rawToken.trim();
  if (!token || !process.env.DATABASE_URL) {
    return { kind: "not_found" };
  }

  const preview = await prisma.candidateExperiencePreview.findUnique({
    where: { tokenDigest: digestPreviewToken(token) },
  });
  if (!preview || !isCandidatePreviewActive(preview)) {
    return { kind: "not_found" };
  }

  const parsed = candidateExperiencePreviewSnapshotSchema.safeParse(
    preview.snapshot,
  );
  if (!parsed.success) {
    return { kind: "not_found" };
  }

  const snapshot = parsed.data;
  return {
    expiresAt: preview.expiresAt,
    interview: {
      companyName: snapshot.companyName,
      estimatedMinutes: snapshot.plan.estimatedMinutes,
      id: preview.id,
      jobId: snapshot.jobId,
      jobTitle: snapshot.jobTitle,
      organizationId: preview.organizationId,
      publicToken: token,
      questions: snapshot.plan.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        signal: question.expectedSignal ?? null,
      })),
      responseModes: resolvePreviewResponseModes(snapshot.plan.responseModes),
      roleTitle: snapshot.plan.roleTitle,
    },
    kind: "preview",
    returnPath: `/roles/new?draftId=${encodeURIComponent(preview.draftId)}`,
  };
}

export async function prepareCandidateExperiencePreviewSession(input: {
  consentAccepted: boolean;
  previewToken: string;
}) {
  if (!input.consentAccepted) {
    return {
      error: "consent_required" as const,
      ok: false as const,
      status: 400,
    };
  }

  const context = await getCandidateExperiencePreviewContext(
    input.previewToken,
  );
  if (context.kind !== "preview") {
    return {
      error: "preview_not_found" as const,
      ok: false as const,
      status: 404,
    };
  }

  const allowedModalities = resolveAllowedModalities(
    context.interview.responseModes,
    false,
  );
  if (!allowedModalities.includes("audio")) {
    return {
      error: "preview_audio_unavailable" as const,
      ok: false as const,
      status: 400,
    };
  }

  const now = new Date();
  const runtimeExpiresAt = candidatePreviewRuntimeExpiresAt(now);
  const current = await prisma.candidateExperiencePreview.findUnique({
    select: { liveTestCount: true, runtimeExpiresAt: true },
    where: { id: context.interview.id },
  });
  if (
    !current ||
    current.liveTestCount >= candidatePreviewPolicy.liveTestLimit
  ) {
    return {
      error: "preview_live_test_limit_reached" as const,
      ok: false as const,
      status: 409,
    };
  }
  const reserved = await prisma.candidateExperiencePreview.updateMany({
    data: {
      liveTestCount: { increment: 1 },
      runtimeExpiresAt,
    },
    where: {
      expiresAt: { gt: now },
      id: context.interview.id,
      liveTestCount: current.liveTestCount,
      revokedAt: null,
      runtimeExpiresAt: current.runtimeExpiresAt,
    },
  });
  if (reserved.count !== 1) {
    return {
      error: "preview_live_test_limit_reached" as const,
      ok: false as const,
      status: 409,
    };
  }

  return {
    allowedModalities: ["audio"] as const,
    candidateId: `preview_${randomBytes(18).toString("base64url")}`,
    expiresAt: runtimeExpiresAt,
    interviewPlanId: context.interview.id,
    ok: true as const,
    reservation: {
      previousLiveTestCount: current.liveTestCount,
      previousRuntimeExpiresAt: current.runtimeExpiresAt,
      previewId: context.interview.id,
      runtimeExpiresAt,
    },
  };
}

export async function releaseCandidateExperiencePreviewReservation(input: {
  previousLiveTestCount: number;
  previousRuntimeExpiresAt: Date | null;
  previewId: string;
  runtimeExpiresAt: Date;
}) {
  await prisma.candidateExperiencePreview.updateMany({
    data: {
      liveTestCount: input.previousLiveTestCount,
      runtimeExpiresAt: input.previousRuntimeExpiresAt,
    },
    where: {
      id: input.previewId,
      liveTestCount: input.previousLiveTestCount + 1,
      runtimeExpiresAt: input.runtimeExpiresAt,
    },
  });
}

function digestPreviewToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

function resolvePreviewResponseModes(responseModes: string[]) {
  const modes = responseModes.flatMap((mode) => {
    if (mode === "audio") {
      return ["audio"];
    }
    if (mode === "text" || mode === "form") {
      return ["form"];
    }
    return [];
  });
  return modes.length > 0 ? [...new Set(modes)] : ["audio"];
}
