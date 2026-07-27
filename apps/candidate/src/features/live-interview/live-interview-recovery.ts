export const LIVE_INTERVIEW_RECOVERY_POLICY = {
  attemptTimeoutMs: 8_000,
  initialRetryDelayMs: 1_000,
  maxRetryDelayMs: 30_000,
  recoveryWindowMs: 5 * 60_000,
} as const;

export class LiveInterviewRecoveryError extends Error {
  constructor(
    message: "recovery_aborted" | "recovery_exhausted",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveInterviewRecoveryError";
  }
}

type RecoveryAttempt = {
  attempt: number;
  signal: AbortSignal;
};

type RecoveryPolicy = {
  attemptTimeoutMs: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  recoveryWindowMs: number;
};

export async function recoverLiveInterviewConnection<T>({
  acceptResult,
  attempt,
  onAttempt,
  policy = LIVE_INTERVIEW_RECOVERY_POLICY,
  signal,
}: {
  acceptResult?: (result: T) => boolean;
  attempt: (context: RecoveryAttempt) => Promise<T>;
  onAttempt?: (attempt: number) => void;
  policy?: RecoveryPolicy;
  signal: AbortSignal;
}): Promise<T> {
  const deadline = Date.now() + policy.recoveryWindowMs;
  let lastError: unknown;
  let attemptNumber = 0;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    attemptNumber += 1;
    const retryDelay = retryDelayForAttempt(attemptNumber, policy);
    const remainingBeforeRetry = deadline - Date.now();
    await waitForRetry(
      Math.min(retryDelay, Math.max(0, remainingBeforeRetry)),
      signal,
    );
    if (Date.now() >= deadline) {
      break;
    }
    onAttempt?.(attemptNumber);

    const attemptController = new AbortController();
    const abortAttempt = () => attemptController.abort(signal.reason);
    signal.addEventListener("abort", abortAttempt, { once: true });
    const timeout = setTimeout(
      () => attemptController.abort(new Error("recovery_attempt_timeout")),
      Math.min(policy.attemptTimeoutMs, deadline - Date.now()),
    );

    try {
      const result = await raceWithAbort(
        attempt({ attempt: attemptNumber, signal: attemptController.signal }),
        attemptController.signal,
      );
      if (!acceptResult || acceptResult(result)) {
        return result;
      }
      lastError = new Error("recovered_connection_lost_before_handoff");
    } catch (cause) {
      if (signal.aborted) {
        throw new LiveInterviewRecoveryError("recovery_aborted", {
          cause: signal.reason,
        });
      }
      lastError = cause;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortAttempt);
    }
  }

  throw new LiveInterviewRecoveryError("recovery_exhausted", {
    cause: lastError,
  });
}

function retryDelayForAttempt(
  attempt: number,
  policy: RecoveryPolicy,
): number {
  if (attempt === 1) {
    return 0;
  }

  const exponentialDelay =
    Math.max(1, policy.initialRetryDelayMs) * 2 ** (attempt - 2);
  return Math.min(exponentialDelay, policy.maxRetryDelayMs);
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(
        new LiveInterviewRecoveryError("recovery_aborted", {
          cause: signal.reason,
        }),
      );
    };

    signal.addEventListener("abort", abort, { once: true });
  });
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new LiveInterviewRecoveryError("recovery_aborted", {
      cause: signal.reason,
    });
  }
}
