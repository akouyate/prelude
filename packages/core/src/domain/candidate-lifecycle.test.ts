import { describe, expect, it } from "vitest";

import {
  canTransitionCandidateLifecycle,
  candidateLifecycleTerminalStatuses,
  normalizeCandidateLifecycleStatus,
  resolveCandidateConsentGate,
  resolveCandidateStartPolicy,
  transitionCandidateLifecycle,
} from "./candidate-lifecycle";
import { validCandidateConsentCopyVersions } from "../policies/ai";

describe("candidate lifecycle policy", () => {
  it("normalizes legacy runtime/product statuses into the V1 candidate lifecycle", () => {
    expect(normalizeCandidateLifecycleStatus("created")).toBe("invited");
    expect(normalizeCandidateLifecycleStatus("started")).toBe("starting");
    expect(normalizeCandidateLifecycleStatus("waiting_candidate")).toBe(
      "starting",
    );
    expect(normalizeCandidateLifecycleStatus("agent_joining")).toBe("starting");
    expect(normalizeCandidateLifecycleStatus("paused")).toBe("reconnecting");
    expect(normalizeCandidateLifecycleStatus("completed")).toBe("completed");
    expect(normalizeCandidateLifecycleStatus("unknown")).toBeNull();
  });

  it("accepts the expected happy path and rejects terminal mutations", () => {
    expect(transitionCandidateLifecycle("invited", "open")).toEqual({
      ok: true,
      status: "opened",
    });
    expect(transitionCandidateLifecycle("opened", "require_consent")).toEqual({
      ok: true,
      status: "consent_required",
    });
    expect(
      transitionCandidateLifecycle("consent_required", "accept_consent"),
    ).toEqual({
      ok: true,
      status: "ready",
    });
    expect(transitionCandidateLifecycle("ready", "start")).toEqual({
      ok: true,
      status: "starting",
    });
    expect(
      transitionCandidateLifecycle("starting", "mark_in_progress"),
    ).toEqual({
      ok: true,
      status: "in_progress",
    });
    expect(transitionCandidateLifecycle("in_progress", "disconnect")).toEqual({
      ok: true,
      status: "reconnecting",
    });
    expect(transitionCandidateLifecycle("reconnecting", "recover")).toEqual({
      ok: true,
      status: "in_progress",
    });
    expect(transitionCandidateLifecycle("in_progress", "complete")).toEqual({
      ok: true,
      status: "completed",
    });

    for (const status of candidateLifecycleTerminalStatuses) {
      expect(canTransitionCandidateLifecycle(status, "complete")).toBe(false);
      expect(canTransitionCandidateLifecycle(status, "start")).toBe(false);
    }
  });

  it("treats consent as a gate, not as a normal mutable interview state", () => {
    expect(
      resolveCandidateConsentGate({
        consentCopyVersion: null,
        consentedAt: null,
        requiredConsentCopyVersion: "candidate-consent-v2",
      }),
    ).toEqual({
      accepted: false,
      reason: "missing",
      status: "consent_required",
    });
    expect(
      resolveCandidateConsentGate({
        consentCopyVersion: "candidate-consent-v1",
        consentedAt: new Date("2026-06-20T10:00:00.000Z"),
        requiredConsentCopyVersion: "candidate-consent-v2",
      }),
    ).toEqual({
      accepted: false,
      reason: "outdated",
      status: "consent_required",
    });
    expect(
      resolveCandidateConsentGate({
        consentCopyVersion: "candidate-consent-v2",
        consentedAt: new Date("2026-06-20T10:00:00.000Z"),
        requiredConsentCopyVersion: "candidate-consent-v2",
      }),
    ).toEqual({
      accepted: true,
      reason: null,
      status: "ready",
    });
  });

  it("recognises every consent version still in force, not just one", () => {
    // The v3 variant pair means there is no single "current" id any more: a
    // session carries the id of the variant its candidate actually read. A gate
    // pinned to one string would silently stop recognising freshly consented
    // candidates the day v3 shipped.
    expect(validCandidateConsentCopyVersions).toEqual([
      "candidate-consent-v2",
      "candidate-consent-v3",
      "candidate-consent-v3-no-recording",
    ]);

    validCandidateConsentCopyVersions.forEach((version) => {
      expect(
        resolveCandidateConsentGate({
          consentCopyVersion: version,
          consentedAt: new Date("2026-08-19T10:00:00.000Z"),
        }),
      ).toEqual({ accepted: true, reason: null, status: "ready" });
    });

    // v1 predates the voice disclosure entirely and is not a valid consent.
    expect(
      resolveCandidateConsentGate({
        consentCopyVersion: "candidate-consent-v1",
        consentedAt: new Date("2026-06-20T10:00:00.000Z"),
      }),
    ).toEqual({
      accepted: false,
      reason: "outdated",
      status: "consent_required",
    });
  });

  it("keeps active attempts resumable and terminal attempts immutable", () => {
    expect(resolveCandidateStartPolicy("starting")).toEqual({
      action: "resume_same_attempt",
      reason: null,
    });
    expect(resolveCandidateStartPolicy("in_progress")).toEqual({
      action: "resume_same_attempt",
      reason: null,
    });
    expect(resolveCandidateStartPolicy("failed")).toEqual({
      action: "retry_new_attempt",
      reason: null,
    });
    expect(resolveCandidateStartPolicy("abandoned")).toEqual({
      action: "retry_new_attempt",
      reason: null,
    });
    expect(resolveCandidateStartPolicy("completed")).toEqual({
      action: "reject",
      reason: "completed",
    });
    expect(resolveCandidateStartPolicy("expired")).toEqual({
      action: "reject",
      reason: "expired",
    });
    expect(resolveCandidateStartPolicy("superseded")).toEqual({
      action: "reject",
      reason: "superseded",
    });
  });
});
