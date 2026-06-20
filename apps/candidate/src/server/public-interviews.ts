import { randomBytes } from "node:crypto";

import { prisma } from "@prelude/db";

export const candidateConsentCopyVersion = "candidate-consent-v1";

export type PublicInterviewContext =
  | {
      kind: "published";
      interview: {
        companyName: string;
        estimatedMinutes: number | null;
        id: string;
        jobId: string;
        jobTitle: string;
        organizationId: string;
        publicToken: string;
        responseModes: string[];
        roleTitle: string;
      };
    }
  | {
      kind: "not_found";
    };

export type StartCandidateInterviewInput = {
  candidateEmail?: string;
  candidateName?: string;
  candidateToken: string;
  consentAccepted: boolean;
  resumeToken?: string;
  videoEnabled?: boolean;
};

export type CompleteCandidateSessionInput = {
  resumeToken?: string | null;
  sessionId: string;
};

export async function getPublicInterviewContext(
  candidateToken: string,
): Promise<PublicInterviewContext> {
  const token = candidateToken.trim();

  if (!token) {
    return { kind: "not_found" };
  }

  if (!process.env.DATABASE_URL) {
    return { kind: "not_found" };
  }

  const interview = await prisma.interview.findFirst({
    include: {
      job: true,
      organization: true,
    },
    where: {
      publicToken: token,
      status: "published",
    },
  });

  if (!interview) {
    return { kind: "not_found" };
  }

  return {
    interview: {
      companyName: interview.organization.name,
      estimatedMinutes: interview.estimatedMinutes,
      id: interview.id,
      jobId: interview.jobId,
      jobTitle: interview.job.title,
      organizationId: interview.organizationId,
      publicToken: interview.publicToken,
      responseModes: readStringArray(interview.responseModes),
      roleTitle: interview.roleTitle,
    },
    kind: "published",
  };
}

export async function prepareCandidateSession(
  input: StartCandidateInterviewInput,
) {
  const token = input.candidateToken.trim();
  const context = await getPublicInterviewContext(token);

  if (context.kind === "not_found") {
    return {
      ok: false as const,
      error: "interview_not_found" as const,
      status: 404,
    };
  }

  if (!input.consentAccepted) {
    return {
      ok: false as const,
      error: "consent_required" as const,
      status: 400,
    };
  }

  const candidateEmail = normalizeEmail(input.candidateEmail);
  const candidateName = normalizeName(input.candidateName);
  const now = new Date();
  const existingSession = input.resumeToken
    ? await prisma.candidateSession.findFirst({
        where: {
          interviewId: context.interview.id,
          resumeToken: input.resumeToken,
          status: {
            in: ["created", "failed", "started", "waiting_candidate"],
          },
        },
      })
    : null;

  const productSession = existingSession
    ? await prisma.candidateSession.update({
        data: {
          candidateEmail,
          candidateName,
          consentCopyVersion: candidateConsentCopyVersion,
          consentedAt: existingSession.consentedAt ?? now,
          startedAt: existingSession.startedAt ?? now,
          status: "started",
        },
        where: { id: existingSession.id },
      })
    : await prisma.candidateSession.create({
        data: {
          candidateEmail,
          candidateName,
          consentCopyVersion: candidateConsentCopyVersion,
          consentedAt: now,
          interviewId: context.interview.id,
          jobId: context.interview.jobId,
          organizationId: context.interview.organizationId,
          resumeToken: createResumeToken(),
          startedAt: now,
          status: "started",
        },
      });

  return {
    ok: true as const,
    allowedModalities: resolveAllowedModalities(
      context.interview.responseModes,
      input.videoEnabled,
    ),
    candidateId: productSession.id,
    interviewPlanId: context.interview.id,
    productSession,
    resumeToken: productSession.resumeToken,
  };
}

export function resolveAllowedModalities(value: unknown, videoEnabled = true) {
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

export async function completeCandidateSession(
  input: CompleteCandidateSessionInput,
) {
  const resumeToken = input.resumeToken?.trim();

  if (!input.sessionId || !resumeToken) {
    return { ok: false as const, status: 400 };
  }

  const result = await prisma.candidateSession.updateMany({
    data: {
      completedAt: new Date(),
      status: "completed",
    },
    where: {
      id: input.sessionId,
      resumeToken,
      status: {
        in: ["failed", "in_progress", "started", "waiting_candidate"],
      },
    },
  });

  if (result.count === 0) {
    return { ok: false as const, status: 404 };
  }

  return { ok: true as const };
}

function normalizeEmail(value?: string) {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 3 ? trimmed : null;
}

function normalizeName(value?: string) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 1 ? trimmed : null;
}

function createResumeToken() {
  return `cs_${randomBytes(18).toString("base64url")}`;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
