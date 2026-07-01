import { candidateConsentCopyVersion } from "../policies/ai";

export const candidateLifecycleStatuses = [
  "invited",
  "opened",
  "consent_required",
  "ready",
  "starting",
  "in_progress",
  "reconnecting",
  "completed",
  "abandoned",
  "failed",
  "expired",
  "superseded",
] as const;

export type CandidateLifecycleStatus =
  (typeof candidateLifecycleStatuses)[number];

export const candidateLifecycleTerminalStatuses = [
  "completed",
  "expired",
  "superseded",
] as const satisfies CandidateLifecycleStatus[];

export type CandidateLifecycleTerminalStatus =
  (typeof candidateLifecycleTerminalStatuses)[number];

export const candidateLifecycleActiveStatuses = [
  "starting",
  "in_progress",
  "reconnecting",
] as const satisfies CandidateLifecycleStatus[];

export type CandidateLifecycleActiveStatus =
  (typeof candidateLifecycleActiveStatuses)[number];

export const candidateLifecycleLegacyStatusMap = {
  agent_joining: "starting",
  created: "invited",
  paused: "reconnecting",
  started: "starting",
  waiting_candidate: "starting",
} as const satisfies Record<string, CandidateLifecycleStatus>;

export type CandidateLifecycleEvent =
  | "open"
  | "require_consent"
  | "confirm_ready"
  | "accept_consent"
  | "start"
  | "mark_in_progress"
  | "disconnect"
  | "recover"
  | "complete"
  | "abandon"
  | "fail"
  | "expire"
  | "retry"
  | "supersede";

export type CandidateLifecycleTransitionResult =
  | {
      ok: true;
      status: CandidateLifecycleStatus;
    }
  | {
      error: "invalid_transition" | "unknown_status";
      ok: false;
    };

export type CandidateConsentGateResult =
  | {
      accepted: true;
      reason: null;
      status: "ready";
    }
  | {
      accepted: false;
      reason: "missing" | "outdated";
      status: "consent_required";
    };

export type CandidateStartPolicy =
  | {
      action: "start_new_attempt" | "resume_same_attempt" | "retry_new_attempt";
      reason: null;
    }
  | {
      action: "reject";
      reason: CandidateLifecycleTerminalStatus | "unknown_status";
    };

const lifecycleTransitions: Record<
  CandidateLifecycleStatus,
  Partial<Record<CandidateLifecycleEvent, CandidateLifecycleStatus>>
> = {
  abandoned: {
    retry: "ready",
    supersede: "superseded",
  },
  completed: {},
  consent_required: {
    accept_consent: "ready",
    expire: "expired",
  },
  expired: {},
  failed: {
    retry: "ready",
    supersede: "superseded",
  },
  in_progress: {
    abandon: "abandoned",
    complete: "completed",
    disconnect: "reconnecting",
    fail: "failed",
  },
  invited: {
    expire: "expired",
    open: "opened",
  },
  opened: {
    confirm_ready: "ready",
    expire: "expired",
    require_consent: "consent_required",
  },
  ready: {
    expire: "expired",
    start: "starting",
  },
  reconnecting: {
    abandon: "abandoned",
    fail: "failed",
    recover: "in_progress",
  },
  starting: {
    abandon: "abandoned",
    fail: "failed",
    mark_in_progress: "in_progress",
  },
  superseded: {},
};

export function isCandidateLifecycleStatus(
  value: string | null | undefined,
): value is CandidateLifecycleStatus {
  return candidateLifecycleStatuses.includes(value as CandidateLifecycleStatus);
}

export function normalizeCandidateLifecycleStatus(
  value: string | null | undefined,
): CandidateLifecycleStatus | null {
  if (!value) {
    return null;
  }

  if (isCandidateLifecycleStatus(value)) {
    return value;
  }

  return (
    (
      candidateLifecycleLegacyStatusMap as Record<
        string,
        CandidateLifecycleStatus
      >
    )[value] ?? null
  );
}

export function transitionCandidateLifecycle(
  currentStatus: string | null | undefined,
  event: CandidateLifecycleEvent,
): CandidateLifecycleTransitionResult {
  const normalizedStatus = normalizeCandidateLifecycleStatus(currentStatus);

  if (!normalizedStatus) {
    return { error: "unknown_status", ok: false };
  }

  const nextStatus = lifecycleTransitions[normalizedStatus][event];
  if (!nextStatus) {
    return { error: "invalid_transition", ok: false };
  }

  return { ok: true, status: nextStatus };
}

export function canTransitionCandidateLifecycle(
  currentStatus: string | null | undefined,
  event: CandidateLifecycleEvent,
) {
  return transitionCandidateLifecycle(currentStatus, event).ok;
}

export function resolveCandidateConsentGate({
  consentCopyVersion,
  consentedAt,
  requiredConsentCopyVersion = candidateConsentCopyVersion,
}: {
  consentCopyVersion: string | null | undefined;
  consentedAt: Date | string | null | undefined;
  requiredConsentCopyVersion?: string;
}): CandidateConsentGateResult {
  if (!consentedAt || !consentCopyVersion) {
    return {
      accepted: false,
      reason: "missing",
      status: "consent_required",
    };
  }

  if (consentCopyVersion !== requiredConsentCopyVersion) {
    return {
      accepted: false,
      reason: "outdated",
      status: "consent_required",
    };
  }

  return {
    accepted: true,
    reason: null,
    status: "ready",
  };
}

export function resolveCandidateStartPolicy(
  currentStatus: string | null | undefined,
): CandidateStartPolicy {
  const normalizedStatus = normalizeCandidateLifecycleStatus(currentStatus);

  if (!normalizedStatus) {
    return { action: "reject", reason: "unknown_status" };
  }

  if (normalizedStatus === "completed") {
    return { action: "reject", reason: "completed" };
  }

  if (normalizedStatus === "expired") {
    return { action: "reject", reason: "expired" };
  }

  if (normalizedStatus === "superseded") {
    return { action: "reject", reason: "superseded" };
  }

  if (normalizedStatus === "failed" || normalizedStatus === "abandoned") {
    return { action: "retry_new_attempt", reason: null };
  }

  if (
    normalizedStatus === "starting" ||
    normalizedStatus === "in_progress" ||
    normalizedStatus === "reconnecting" ||
    normalizedStatus === "ready"
  ) {
    return { action: "resume_same_attempt", reason: null };
  }

  return { action: "start_new_attempt", reason: null };
}

export function mapRealtimeStatusToCandidateLifecycleStatus(
  realtimeStatus: string | null | undefined,
): CandidateLifecycleStatus {
  switch (realtimeStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "in_progress":
      return "in_progress";
    case "paused":
      return "reconnecting";
    case "agent_joining":
    case "waiting_candidate":
    case "created":
    default:
      return "starting";
  }
}
