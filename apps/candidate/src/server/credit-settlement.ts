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
  // Every call site passes the terminal status it just wrote, so the ledger's
  // append-only release reason reads back as the status that caused it. Only
  // `completed` runs the billable-threshold evaluation; every other kind flows
  // straight through as a release reason.
  kind: "abandoned" | "completed" | "expired" | "failed" | "superseded";
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
 * Never throws. The terminal write it follows is already durable when it runs, so
 * a billing outage must not turn a finished interview into a candidate-facing
 * error. That makes this call the *only* thing that returns a hold on time: in
 * Phase 1 nothing schedules `releaseExpiredReservations`, and the sole sweep in
 * the flow is the one `reserveCreditForSession` runs for an organization as it
 * admits its next session — so a hold this call drops stays reserved until that
 * organization starts another interview, and indefinitely if it never does. The
 * scheduled sweep is Phase 2 ops work; do not read the TTL as a safety net that
 * already exists.
 *
 * A session with nothing to settle (admitted while the flag was off, or in the
 * crash window between session creation and reservation) is a normal outcome:
 * capture and release both report `no_reservation`.
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

    if (!session.realtimeSessionId) {
      // A completion with no runtime session has no evidence anyone can bill
      // against, and on money the burden of proof sits with the charge. This
      // branch used to synthesise a fully-answered interview, on the premise
      // that the written fallback was the path arriving here; that premise was
      // wrong — the fallback publishes its own events and sets
      // `realtimeSessionId` before it completes, so it never reaches this line.
      // What is left is only the unexplained case, which must not be charged.
      await dependencies.release(db, {
        candidateSessionId: input.sessionId,
        now: input.now,
        organizationId: session.organizationId,
        reason: "no_billable_evidence",
      });
      return;
    }

    const plannedQuestionCount = Array.isArray(session.interview.questions)
      ? session.interview.questions.length
      : 0;
    const decision = evaluateBillableCompletion({
      outcomes: await loadQuestionOutcomes(db, session.realtimeSessionId),
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
  realtimeSessionId: string,
): Promise<QuestionOutcome[]> {
  const events = await db.liveInterviewEvent.findMany({
    orderBy: { sequenceNumber: "asc" },
    select: { payload: true },
    where: { sessionId: realtimeSessionId, type: "question_completed" },
  });

  // One outcome per question is the domain truth, but the event store's
  // idempotency is per event: a worker that re-emits `question_completed` for a
  // question it already closed writes a second row. `evaluateBillableCompletion`
  // counts rows, and a duplicate always counts toward billable, so the collapse
  // has to happen here. The `orderBy` above is load-bearing, not cosmetic: this
  // loop keeps the last row it sees per question, which is the question's final
  // verdict only because the rows arrive in ascending sequence — a re-emission
  // is a correction, not noise.
  const outcomeByQuestion = new Map<string, QuestionOutcome>();
  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : {};
    // The live path stores the agent's snake_case payload verbatim; the written
    // fallback in `public-interviews.ts` writes camelCase into the same column.
    const questionId = readPayloadString(payload, "question_id", "questionId");
    if (!questionId) {
      // An outcome that cannot be attributed to a question is not a question
      // outcome. Counting it would only ever add to the answered tally, so a
      // malformed payload could push a session over the threshold; dropping it
      // fails toward not charging.
      continue;
    }

    outcomeByQuestion.set(questionId, {
      completionReason: readPayloadString(
        payload,
        "completion_reason",
        "completionReason",
      ),
    });
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
