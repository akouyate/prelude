import {
  captureReservationForSession,
  isCreditBillingEnabled,
  releaseReservationForSession,
} from "@prelude/billing";
import { evaluateBillableCompletion, type QuestionOutcome } from "@prelude/core";
import { type PrismaClient } from "@prelude/db";

// Same contravariance constraint as `billing-admission.ts`: `capture`/`release`
// are frozen at `db: PrismaClient`, so no narrower `Pick` is assignable here.
// This module only ever touches `candidateSession` and `liveInterviewEvent`
// directly, plus the wallet tables reached through the two ledger calls.
type CreditSettlementDatabase = PrismaClient;

type CreditSettlementDependencies = {
  capture: typeof captureReservationForSession;
  release: typeof releaseReservationForSession;
};

export type SettleCandidateSessionCreditInput = {
  kind: "abandoned" | "completed" | "failed";
  now: Date;
  sessionId: string;
};

const defaultDependencies: CreditSettlementDependencies = {
  capture: captureReservationForSession,
  release: releaseReservationForSession,
};

/**
 * Settles the credit admission reserved for this session: a completed interview
 * that cleared the billable threshold consumes it, everything else hands it back.
 *
 * Never throws. Both terminal writes it follows are already durable when it runs,
 * so a billing outage must not turn a finished interview into a candidate-facing
 * error — and the ledger has its own backstops for whatever this call misses: an
 * unreleased hold is swept at `RESERVATION_TTL_HOURS`, and a session admitted
 * while the flag was off (or in the crash window between session creation and
 * reservation) simply has nothing to settle, which capture and release both
 * report as `no_reservation`.
 */
export async function settleCandidateSessionCredit(
  db: CreditSettlementDatabase,
  input: SettleCandidateSessionCreditInput,
  dependencies: CreditSettlementDependencies = defaultDependencies,
): Promise<void> {
  if (!isCreditBillingEnabled()) {
    return;
  }

  try {
    const session = await db.candidateSession.findUnique({
      select: {
        interview: { select: { questions: true } },
        organizationId: true,
        realtimeSessionId: true,
      },
      where: { id: input.sessionId },
    });

    if (!session) {
      return;
    }

    if (input.kind !== "completed") {
      await dependencies.release(db, {
        candidateSessionId: input.sessionId,
        now: input.now,
        organizationId: session.organizationId,
        reason: input.kind,
      });
      return;
    }

    const plannedQuestionCount = Array.isArray(session.interview.questions)
      ? session.interview.questions.length
      : 0;
    const decision = evaluateBillableCompletion({
      outcomes: await loadQuestionOutcomes(db, {
        plannedQuestionCount,
        realtimeSessionId: session.realtimeSessionId,
      }),
      plannedQuestionCount,
    });

    if (decision.billable) {
      await dependencies.capture(db, {
        candidateSessionId: input.sessionId,
        now: input.now,
        organizationId: session.organizationId,
      });
      return;
    }

    await dependencies.release(db, {
      candidateSessionId: input.sessionId,
      now: input.now,
      organizationId: session.organizationId,
      reason: "below_billable_threshold",
    });
  } catch (error) {
    console.error("[credit-settlement] failed to settle a candidate session", {
      error,
      kind: input.kind,
      sessionId: input.sessionId,
    });
  }
}

async function loadQuestionOutcomes(
  db: CreditSettlementDatabase,
  {
    plannedQuestionCount,
    realtimeSessionId,
  }: { plannedQuestionCount: number; realtimeSessionId: string | null },
): Promise<QuestionOutcome[]> {
  if (!realtimeSessionId) {
    // No runtime evidence to consult. The written fallback is the only path that
    // completes a session without one, and it rejects empty submissions before
    // the completion write, so its answers are all there.
    return Array.from({ length: plannedQuestionCount }, () => ({
      completionReason: "answered",
    }));
  }

  const events = await db.liveInterviewEvent.findMany({
    orderBy: { sequenceNumber: "asc" },
    select: { payload: true, sequenceNumber: true },
    where: { sessionId: realtimeSessionId, type: "question_completed" },
  });

  // One outcome per question is the domain truth, but the event store's
  // idempotency is per event: a worker that re-emits `question_completed` for a
  // question it already closed writes a second row. `evaluateBillableCompletion`
  // counts rows, and a duplicate always counts toward billable, so the collapse
  // has to happen here. Ascending sequence with last-write-wins keeps the final
  // verdict a question was left with — a re-emission is a correction, not noise.
  const outcomeByQuestion = new Map<string, QuestionOutcome>();
  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : {};
    // The live path stores the agent's snake_case payload verbatim; the written
    // fallback in `public-interviews.ts` writes camelCase into the same column.
    const questionId = readPayloadString(payload, "question_id", "questionId");
    outcomeByQuestion.set(
      // An event with no question id cannot be attributed, so it stays on its
      // own key rather than collapsing every unattributable row into one.
      questionId || `sequence:${event.sequenceNumber}`,
      {
        completionReason: readPayloadString(
          payload,
          "completion_reason",
          "completionReason",
        ),
      },
    );
  }

  return [...outcomeByQuestion.values()];
}

function readPayloadString(
  payload: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
