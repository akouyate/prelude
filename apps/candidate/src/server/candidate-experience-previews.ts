import { createHash, randomBytes } from "node:crypto";

import { candidateExperiencePreviewSnapshotSchema } from "@prelude/contracts";
import {
  candidatePreviewPolicy,
  candidatePreviewRuntimeExpiresAt,
  isCandidatePreviewActive,
} from "@prelude/core";
import { prisma } from "@prelude/db";

import { resolveCandidateRenderingLanguage } from "./interview-language";
import {
  releaseMarketingDemoStart,
  reserveMarketingDemoStart,
} from "./marketing-demo-admission";
import { MarketingDemoRequestError } from "./marketing-demo-security";
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
  if (!preview) {
    return { kind: "not_found" };
  }

  const parsed = candidateExperiencePreviewSnapshotSchema.safeParse(
    preview.snapshot,
  );
  if (!parsed.success) {
    return { kind: "not_found" };
  }
  if (!isCandidatePreviewActive(preview)) {
    return parsed.data.schemaVersion === 2 &&
      parsed.data.variant === "marketing_demo"
      ? { kind: "not_found", previewVariant: "marketing_demo" }
      : { kind: "not_found" };
  }

  const snapshot = parsed.data;
  const previewVariant =
    snapshot.schemaVersion === 1 ? "recruiter_preview" : snapshot.variant;
  const marketingDemo =
    snapshot.schemaVersion === 2 && snapshot.variant === "marketing_demo"
      ? snapshot.marketingDemo
      : null;
  return {
    expiresAt: preview.expiresAt,
    interview: {
      companyName: snapshot.companyName,
      // The marketing experience never promises the fixture plan's internal
      // eight-minute estimate. The voice runtime has its own server ceiling.
      estimatedMinutes:
        previewVariant === "marketing_demo"
          ? null
          : snapshot.plan.estimatedMinutes,
      id: preview.id,
      jobId: snapshot.jobId,
      jobTitle: snapshot.jobTitle,
      // The recruiter previews the candidate experience, so it renders in the
      // draft's own language — same resolution (and same "fr" fallback) as a
      // published interview, because the preview live test runs on the same
      // realtime pipeline.
      language: resolveCandidateRenderingLanguage(snapshot.plan.language),
      organizationId: preview.organizationId,
      publicToken: token,
      questions: snapshot.plan.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        signal: question.expectedSignal ?? null,
      })),
      // A preview never records: the Go service refuses egress for a preview
      // session outright, so the recruiter must be shown the no-recording copy
      // whatever `RECORDING_ENABLED` says. Hard-coded rather than resolved, so
      // turning recording on can never make a preview claim a recording that
      // will not happen.
      recordingActive: false,
      responseModes:
        previewVariant === "marketing_demo"
          ? ["audio"]
          : resolvePreviewResponseModes(snapshot.plan.responseModes),
      roleTitle: snapshot.plan.roleTitle,
    },
    kind: "preview",
    marketingDemo: marketingDemo
      ? {
          postInterviewQuestions: marketingDemo.postInterviewQuestions,
          returnTarget: marketingDemo.returnTarget,
          roleSlug: marketingDemo.roleSlug,
          roleVersion: marketingDemo.roleVersion,
        }
      : null,
    previewVariant,
    returnPath:
      marketingDemo?.returnTarget ??
      `/roles/new?draftId=${encodeURIComponent(preview.draftId)}`,
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
  if (context.previewVariant === "marketing_demo") {
    try {
      const reservation = await reserveMarketingDemoStart(
        context.interview.id,
        now,
      );
      return {
        allowedModalities: ["audio"] as const,
        candidateId: `marketing_demo_${randomBytes(18).toString("base64url")}`,
        expiresAt: reservation.runtimeExpiresAt,
        interviewPlanId: context.interview.id,
        ok: true as const,
        reservation: { kind: "marketing_demo" as const, ...reservation },
      };
    } catch (error) {
      if (error instanceof MarketingDemoRequestError) {
        return {
          error: error.code,
          ok: false as const,
          status: error.status,
        };
      }
      return {
        error: "demo_controls_unavailable" as const,
        ok: false as const,
        status: 503,
      };
    }
  }

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

export async function releaseCandidateExperiencePreviewReservation(
  input:
    | {
        day: Date;
        kind: "marketing_demo";
        previewId: string;
        runtimeExpiresAt: Date;
      }
    | {
        kind?: never;
        previousLiveTestCount: number;
        previousRuntimeExpiresAt: Date | null;
        previewId: string;
        runtimeExpiresAt: Date;
      },
) {
  if (input.kind === "marketing_demo") {
    if (!input.day) {
      throw new Error("Marketing demo reservation day is required.");
    }
    await releaseMarketingDemoStart({
      day: input.day,
      previewId: input.previewId,
      runtimeExpiresAt: input.runtimeExpiresAt,
    });
    return;
  }

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
