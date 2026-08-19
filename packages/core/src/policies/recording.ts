/**
 * What "recording is on" means — the ONE rule, for every process that has to
 * answer that question.
 *
 * The authoritative flag is `RECORDING_ENABLED`, and the authoritative *actor*
 * is the Go realtime service (`recordingEnabled`,
 * `services/realtime/cmd/server/config.go`): that is the process that starts —
 * or refuses to start — an egress. Three readers now depend on agreeing with
 * it, each for a different reason:
 *
 * 1. **`services/realtime` (Go)** — decides whether to record at all.
 * 2. **`apps/candidate`** — decides what the candidate is *told*: which of the
 *    v3 consent variants the pre-join screens render, and which version id gets
 *    stamped on their session.
 * 3. **`apps/console`** — decides what the *recruiter* is shown in the trust
 *    panel before publishing, which claims to be exactly what the candidate
 *    reads. A panel resolving this differently would be a lie about consent.
 *
 * The Go parser stays where it is (it is the reference implementation, and this
 * package cannot be imported from Go). The two TypeScript readers no longer
 * carry their own copy of the rule: they call this function, so "on" cannot
 * come to mean two different things in the same deployment. `recording.test.ts`
 * pins the accepted spellings against the Go switch, read from its source.
 *
 * A mismatch between the flag's *values* across processes still cannot open a
 * hole. The Go consent-version gate accepts only the recording-consent ids
 * (`audioRecordingConsentCopyVersions`, policies/ai.ts) and the no-recording
 * ids are never in that list: a service with recording ON facing an app with
 * the flag OFF stamps a no-recording consent version, and the service then
 * declines to record. The mismatch fails CLOSED — no recording, accurate copy —
 * never unsafely open.
 *
 * Pure by design: no `process.env` read lives here. Each app keeps its own
 * one-line, server-only env wrapper (`isRecordingActive`), because *where* the
 * flag may be read is an app concern; *what it means* is not.
 */

/**
 * The truthy spellings, case-folded and trimmed: the exact `case` list of the
 * Go service's `recordingEnabled` switch. Exported so the parity test can pin
 * it against that source rather than restating it in prose.
 */
export const recordingEnabledTruthyValues = ["1", "true", "yes"] as const;

/**
 * Everything outside `recordingEnabledTruthyValues` — including a missing,
 * empty, or unparseable value — is off. Fail-closed: a flag we cannot read must
 * describe the smaller processing, never the larger one.
 */
export function parseRecordingEnabled(
  value: string | null | undefined,
): boolean {
  const normalized = (value ?? "").trim().toLowerCase();

  return recordingEnabledTruthyValues.some(
    (accepted) => accepted === normalized,
  );
}
