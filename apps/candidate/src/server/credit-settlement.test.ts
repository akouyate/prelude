import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  captureReservationForSession,
  releaseReservationForSession,
} from "@prelude/billing";

import { settleCandidateSessionCredit } from "./credit-settlement";

const now = new Date("2026-08-14T09:00:00.000Z");

beforeEach(() => {
  // Settlement is one half of a flag-gated pair: admission reserves behind
  // `CREDIT_BILLING_ENABLED`, so every test here runs with the flag on except
  // the one that pins the off behaviour.
  vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("settleCandidateSessionCredit", () => {
  it("captures a live session that met the billable threshold", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(1, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { question_id: "q2", completion_reason: "answered" }),
        questionCompleted(3, { question_id: "q3", completion_reason: "skipped" }),
        questionCompleted(4, { question_id: "q4", completion_reason: "skipped" }),
      ],
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.capture).toHaveBeenCalledWith(database, {
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_1",
    });
    expect(deps.release).not.toHaveBeenCalled();
    // The ordering is what makes last-write-wins mean "final verdict"; without
    // it the dedupe below settles on whatever order the database returned.
    expect(database.liveInterviewEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { sequenceNumber: "asc" },
        where: { sessionId: "is_1", type: "question_completed" },
      }),
    );
  });

  it("reads the written fallback's own payload casing", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(3, { questionId: "q1", completionReason: "answered" }),
        questionCompleted(6, { questionId: "q2", completionReason: "skipped" }),
      ],
      session: fakeSession({ questionCount: 2 }),
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("releases a completed session that stayed below the threshold", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(1, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { question_id: "q2", completion_reason: "candidate_silent" }),
      ],
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(database, {
      candidateSessionId: "cs_1",
      now,
      organizationId: "org_1",
      reason: "below_billable_threshold",
    });
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it("releases an abandoned session without reading the event store", async () => {
    const database = fakeDatabase();
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "abandoned", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ reason: "abandoned" }),
    );
    expect(database.liveInterviewEvent.findMany).not.toHaveBeenCalled();
  });

  it("releases a failed session without reading the event store", async () => {
    const database = fakeDatabase();
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "failed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ reason: "failed" }),
    );
    expect(database.liveInterviewEvent.findMany).not.toHaveBeenCalled();
  });

  it("counts one outcome per question when a question_completed event is re-emitted", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(1, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(3, { question_id: "q2", completion_reason: "skipped" }),
      ],
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ reason: "below_billable_threshold" }),
    );
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it("keeps the last outcome recorded for a question", async () => {
    const database = fakeDatabase({
      // Handed over newest-first: only a query that asks for ascending sequence
      // sees the correction as the question's final word.
      events: [
        questionCompleted(7, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { question_id: "q1", completion_reason: "skipped" }),
      ],
      session: fakeSession({ questionCount: 2 }),
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("refuses to charge a completion that carries no runtime evidence", async () => {
    const database = fakeDatabase({
      session: fakeSession({ questionCount: 3, realtimeSessionId: null }),
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ reason: "no_billable_evidence" }),
    );
    expect(deps.capture).not.toHaveBeenCalled();
    expect(database.liveInterviewEvent.findMany).not.toHaveBeenCalled();
  });

  it("drops question_completed rows that name no question", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(1, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { completion_reason: "answered" }),
        questionCompleted(3, { completion_reason: "answered" }),
      ],
    });
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ reason: "below_billable_threshold" }),
    );
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it("releases a superseded session", async () => {
    const database = fakeDatabase();
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "superseded", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.release).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ reason: "superseded" }),
    );
    expect(database.liveInterviewEvent.findMany).not.toHaveBeenCalled();
  });

  it("no-ops for a session that no longer exists", async () => {
    const database = fakeDatabase();
    database.candidateSession.findUnique.mockResolvedValueOnce(null);
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("no-ops without touching the database when credit billing is off", async () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", "");
    const database = fakeDatabase();
    const deps = dependencies();

    await settleCandidateSessionCredit(
      database as never,
      { kind: "completed", now, sessionId: "cs_1" },
      deps,
    );

    expect(database.candidateSession.findUnique).not.toHaveBeenCalled();
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("settles a session that never held a reservation as a no-op", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(1, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { question_id: "q2", completion_reason: "answered" }),
      ],
    });
    const deps = dependencies({
      capture: vi.fn(async () => ({ outcome: "no_reservation" as const })),
    });

    await expect(
      settleCandidateSessionCredit(
        database as never,
        { kind: "completed", now, sessionId: "cs_1" },
        deps,
      ),
    ).resolves.toBeUndefined();
  });

  it("never lets a billing failure break the candidate flow", async () => {
    const database = fakeDatabase({
      events: [
        questionCompleted(1, { question_id: "q1", completion_reason: "answered" }),
        questionCompleted(2, { question_id: "q2", completion_reason: "answered" }),
      ],
    });
    const deps = dependencies({
      capture: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      settleCandidateSessionCredit(
        database as never,
        { kind: "completed", now, sessionId: "cs_1" },
        deps,
      ),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

function fakeSession({
  questionCount = 4,
  realtimeSessionId = "is_1" as string | null,
}: { questionCount?: number; realtimeSessionId?: string | null } = {}) {
  return {
    interview: {
      questions: Array.from({ length: questionCount }, (_, index) => ({
        id: `q${index + 1}`,
        prompt: `Question ${index + 1}`,
      })),
    },
    organizationId: "org_1",
    realtimeSessionId,
  };
}

function questionCompleted(
  sequenceNumber: number,
  payload: Record<string, unknown>,
) {
  return { payload, sequenceNumber };
}

function fakeDatabase({
  events = [] as ReturnType<typeof questionCompleted>[],
  session = fakeSession(),
}: {
  events?: ReturnType<typeof questionCompleted>[];
  session?: ReturnType<typeof fakeSession> | null;
} = {}) {
  return {
    candidateSession: {
      findUnique: vi.fn(async () => session),
    },
    liveInterviewEvent: {
      // The fake orders rows the way Postgres would, so that dropping the
      // `orderBy` from the query is something a test can actually catch: the
      // dedupe's last-write-wins is only a "final verdict" while rows arrive
      // ascending.
      findMany: vi.fn(
        async ({
          orderBy,
        }: { orderBy?: { sequenceNumber?: "asc" | "desc" } } = {}) => {
          const direction = orderBy?.sequenceNumber;
          if (!direction) {
            return events;
          }

          return [...events].sort((left, right) =>
            direction === "asc"
              ? left.sequenceNumber - right.sequenceNumber
              : right.sequenceNumber - left.sequenceNumber,
          );
        },
      ),
    },
  };
}

function dependencies(
  overrides: Partial<{
    capture: typeof captureReservationForSession;
    release: typeof releaseReservationForSession;
  }> = {},
) {
  return {
    capture: vi.fn(async () => ({ outcome: "captured" as const })),
    release: vi.fn(async () => ({ outcome: "released" as const })),
    ...overrides,
  };
}
