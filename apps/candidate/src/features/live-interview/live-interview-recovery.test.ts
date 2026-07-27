import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_INTERVIEW_RECOVERY_POLICY,
  LiveInterviewRecoveryError,
  recoverLiveInterviewConnection,
} from "./live-interview-recovery";

describe("live interview connection recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first successful resumed connection", async () => {
    vi.useFakeTimers();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("network_changed"))
      .mockResolvedValueOnce("connected");
    const recovery = recoverLiveInterviewConnection({
      attempt,
      policy: {
        attemptTimeoutMs: 100,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 20,
        recoveryWindowMs: 1_000,
      },
      signal: new AbortController().signal,
    });
    const assertion = expect(recovery).resolves.toBe("connected");

    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls.map(([context]) => context.attempt)).toEqual([
      1, 2,
    ]);
  });

  it("times out a stalled attempt only when the recovery window expires", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn(
      (_context: { attempt: number; signal: AbortSignal }) =>
        new Promise<string>(() => undefined),
    );
    const recovery = recoverLiveInterviewConnection({
      attempt,
      policy: {
        attemptTimeoutMs: 250,
        initialRetryDelayMs: 100,
        maxRetryDelayMs: 100,
        recoveryWindowMs: 250,
      },
      signal: new AbortController().signal,
    });
    const assertion = expect(recovery).rejects.toEqual(
      expect.objectContaining<Partial<LiveInterviewRecoveryError>>({
        message: "recovery_exhausted",
      }),
    );

    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(attempt).toHaveBeenCalledOnce();
    expect(attempt.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it("recovers after the connection has been unavailable for over two minutes", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const attempt = vi.fn(() => {
      if (Date.now() - startedAt >= 2 * 60_000) {
        return Promise.resolve("connected");
      }
      return Promise.reject(new Error("still_offline"));
    });
    const recovery = recoverLiveInterviewConnection({
      attempt,
      policy: {
        attemptTimeoutMs: 1_000,
        initialRetryDelayMs: 1_000,
        maxRetryDelayMs: 30_000,
        recoveryWindowMs: 5 * 60_000,
      },
      signal: new AbortController().signal,
    });
    const assertion = expect(recovery).resolves.toBe("connected");

    await vi.advanceTimersByTimeAsync(121_000);
    await assertion;
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2 * 60_000);
    expect(attempt).toHaveBeenCalledTimes(9);
  });

  it("retries when the first recovered room disconnects before handoff", async () => {
    const connectedGenerations = new Set<number>();
    let disconnectCount = 1;
    let generation = 0;

    const recovery = recoverLiveInterviewConnection({
      acceptResult: (result) => connectedGenerations.has(result),
      attempt: async () => {
        generation += 1;
        connectedGenerations.add(generation);

        // The initial room was already disconnected. This simulates the first
        // recovered room disconnecting immediately while recovery still owns it.
        if (generation === 1) {
          connectedGenerations.delete(generation);
          disconnectCount += 1;
        }

        return generation;
      },
      policy: {
        attemptTimeoutMs: 100,
        initialRetryDelayMs: 0,
        maxRetryDelayMs: 0,
        recoveryWindowMs: 5 * 60_000,
      },
      signal: new AbortController().signal,
    });

    await expect(recovery).resolves.toBe(2);
    expect(disconnectCount).toBe(2);
    expect(generation).toBe(2);
  });

  it("reports final failure only after the five-minute grace window", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const attempt = vi.fn(
      (): Promise<string> => Promise.reject(new Error("still_offline")),
    );
    const recovery = recoverLiveInterviewConnection({
      attempt,
      policy: LIVE_INTERVIEW_RECOVERY_POLICY,
      signal: new AbortController().signal,
    });
    const outcome = recovery.then(
      () => ({ status: "connected" as const }),
      (error: unknown) => ({
        elapsedMs: Date.now() - startedAt,
        error,
        status: "failed" as const,
      }),
    );

    await vi.advanceTimersByTimeAsync(
      LIVE_INTERVIEW_RECOVERY_POLICY.recoveryWindowMs - 1,
    );
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      throw new Error("expected recovery to exhaust its grace window");
    }
    expect(result.error).toEqual(
      expect.objectContaining<Partial<LiveInterviewRecoveryError>>({
        message: "recovery_exhausted",
      }),
    );
    expect(result.elapsedMs).toBeGreaterThanOrEqual(
      LIVE_INTERVIEW_RECOVERY_POLICY.recoveryWindowMs,
    );
  });

  it("cancels recovery immediately when the candidate intentionally leaves", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const attempt = vi.fn().mockRejectedValue(new Error("offline"));
    const recovery = recoverLiveInterviewConnection({
      attempt,
      policy: {
        attemptTimeoutMs: 500,
        initialRetryDelayMs: 30_000,
        maxRetryDelayMs: 30_000,
        recoveryWindowMs: 5 * 60_000,
      },
      signal: controller.signal,
    });
    const assertion = expect(recovery).rejects.toEqual(
      expect.objectContaining<Partial<LiveInterviewRecoveryError>>({
        message: "recovery_aborted",
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    const abortedAt = Date.now();
    controller.abort();
    await assertion;
    expect(attempt).toHaveBeenCalledOnce();
    expect(Date.now()).toBe(abortedAt);
  });
});
