/**
 * Whether interview audio recording is on for this deployment, as the console
 * needs to know it.
 *
 * The authoritative flag lives on the Go realtime service (`RECORDING_ENABLED`,
 * `services/realtime/cmd/server/config.go`): that is the process that starts —
 * or refuses to start — an egress. This console read MIRRORS it so the
 * pre-publish trust panel quotes the consent variant the candidate will
 * actually be asked to accept, rather than a variant that promises a recording
 * this deployment never makes.
 *
 * **THREE processes now read this env var and they must agree**, set from the
 * same deployment config, under the same name on purpose so a reader of one
 * finds the others:
 *
 * 1. `services/realtime` (Go) — decides whether to record at all.
 * 2. `apps/candidate` (`src/server/recording-state.ts`) — decides what the
 *    candidate is told, and which consent version is stamped on their session.
 * 3. `apps/console` (this file) — decides what the recruiter is shown before
 *    publishing, on a panel whose whole claim is that it prints exactly what
 *    the candidate reads.
 *
 * Drift between the three cannot happen silently at the level of the *rule*:
 * the two TypeScript readers share one `parseRecordingEnabled`, in
 * `@prelude/core` (`policies/recording.ts`), pinned by test against the Go
 * switch's accepted spellings.
 *
 * Drift in the flag's *value* cannot open a hole either. The Go consent-version
 * gate accepts only the recording-consent ids
 * (`audioRecordingConsentCopyVersions`), and the no-recording ids are never in
 * that list: a service with recording ON facing an app with the flag OFF stamps
 * a no-recording consent version, and the service then declines to record. The
 * mismatch fails CLOSED (no recording, accurate copy), never unsafely open.
 *
 * Server-only — the flag must be resolved on a machine that holds the
 * deployment config and threaded into the client builder as a prop, never read
 * from a client component.
 */

import { parseRecordingEnabled } from "@prelude/core";

export function isRecordingActive(): boolean {
  try {
    return parseRecordingEnabled(process.env.RECORDING_ENABLED);
  } catch {
    // An environment that cannot be read is an environment we cannot claim
    // recording from. Same fail-closed direction as an absent flag.
    return false;
  }
}
