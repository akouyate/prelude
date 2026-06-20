import "server-only";

import { prisma } from "@prelude/db";
import {
  isCandidateBriefStatus,
  isRecruiterReviewStatus,
  type CandidateBriefStatus,
  type RecruiterReviewStatus,
} from "@prelude/types";

export type LiveAnalysisStatus = "available" | "pending" | "not_ready" | "failed";
export type { RecruiterReviewStatus };

export type LiveEventStats = {
  answerEvaluationCount: number;
  eventCount: number;
  questionCompletedCount: number;
  transcriptTurnCount: number;
};

export async function getLiveStatusById(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, string>();
  }

  const liveSessions = await prisma.liveInterviewSession.findMany({
    select: {
      id: true,
      status: true,
    },
    where: {
      id: { in: sessionIds },
    },
  });

  return new Map(liveSessions.map((session) => [session.id, session.status]));
}

export async function getLiveEventStatsBySessionId(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, LiveEventStats>();
  }

  const events = await prisma.liveInterviewEvent.findMany({
    select: {
      payload: true,
      sessionId: true,
      type: true,
    },
    where: {
      sessionId: { in: sessionIds },
    },
  });
  const statsById = new Map<string, LiveEventStats>();

  for (const event of events) {
    const stats =
      statsById.get(event.sessionId) ??
      {
        answerEvaluationCount: 0,
        eventCount: 0,
        questionCompletedCount: 0,
        transcriptTurnCount: 0,
      };

    stats.eventCount += 1;
    if (event.type === "answer_evaluated") {
      stats.answerEvaluationCount += 1;
    }
    if (event.type === "question_completed") {
      stats.questionCompletedCount += 1;
    }
    if (eventHasTranscriptTurn(event.payload)) {
      stats.transcriptTurnCount += 1;
    }

    statsById.set(event.sessionId, stats);
  }

  return statsById;
}

export function getQuestionCompletionRate({
  questionCount,
  stats,
}: {
  questionCount: number;
  stats?: LiveEventStats;
}) {
  if (questionCount <= 0) {
    return null;
  }

  return Math.round(
    ((stats?.questionCompletedCount ?? 0) / questionCount) * 100,
  );
}

export function resolveAnalysisStatus(
  status: string,
  stats?: LiveEventStats,
  briefStatus?: string | null,
): LiveAnalysisStatus {
  if (isCandidateBriefStatus(briefStatus)) {
    return resolveBriefAnalysisStatus(briefStatus);
  }

  if (status !== "completed") {
    return "not_ready";
  }

  if ((stats?.answerEvaluationCount ?? 0) > 0) {
    return "available";
  }

  return "pending";
}

export function resolveReviewStatus(
  status: string | null | undefined,
): RecruiterReviewStatus {
  if (isRecruiterReviewStatus(status)) {
    return status;
  }

  if (status === "failed" || status === "expired") {
    return "archived";
  }

  return "to_review";
}

function resolveBriefAnalysisStatus(
  status: CandidateBriefStatus,
): LiveAnalysisStatus {
  if (status === "completed") {
    return "available";
  }

  if (status === "failed") {
    return "failed";
  }

  return "pending";
}

function eventHasTranscriptTurn(payload: unknown) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "transcriptTurn" in payload &&
    Boolean(payload.transcriptTurn)
  );
}
