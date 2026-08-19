/**
 * Whether interview audio recording is on for this deployment.
 *
 * The authoritative flag lives on the Go realtime service
 * (`RECORDING_ENABLED`, `services/realtime/cmd/server/config.go`): that is the
 * process that starts — or refuses to start — an egress. This candidate-app
 * read MIRRORS it so the candidate-facing copy (the privacy notice's recording
 * blocks, and the v3 consent variant pair) describes what will actually happen.
 *
 * **The env var must be set from the same deployment config for every process
 * that reads it**, under the same name on purpose so a reader of one finds the
 * others. There are now THREE readers: the Go realtime service (records or
 * not), this candidate app (what the candidate is told and what version is
 * stamped), and the console (what the recruiter is shown in the pre-publish
 * trust panel, `apps/console/src/server/interviews/recording-state.ts`).
 *
 * A mismatch cannot open a hole. The Go consent-version gate accepts only the
 * recording-consent ids (`audioRecordingConsentCopyVersions`), and the
 * no-recording ids are never in that list: a service with recording ON facing a
 * candidate app with the flag OFF stamps a no-recording consent version, and
 * the service then declines to record. The mismatch fails CLOSED (no recording,
 * accurate copy), never unsafely open (a recording the candidate was not told
 * about).
 *
 * Split in two on purpose: the pure rule is `parseRecordingEnabled`, and it no
 * longer lives here — it lives once in `@prelude/core`
 * (`policies/recording.ts`), where all three readers share a single definition
 * of "on" that is pinned against the Go switch. It is re-exported below so this
 * module keeps its shape and a reader of the mirror still finds the rule.
 * `isRecordingActive` is the one env read, and it stays here: *where* the flag
 * may be read is an app concern. Server-only — never call it from a client
 * component, or the flag would be resolved on a machine that does not hold the
 * deployment config.
 */

import { parseRecordingEnabled } from "@prelude/core";

export { parseRecordingEnabled };

export function isRecordingActive(): boolean {
  try {
    return parseRecordingEnabled(process.env.RECORDING_ENABLED);
  } catch {
    // An environment that cannot be read is an environment we cannot claim
    // recording from. Same fail-closed direction as an absent flag.
    return false;
  }
}
