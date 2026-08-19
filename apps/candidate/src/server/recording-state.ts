/**
 * Whether interview audio recording is on for this deployment.
 *
 * The authoritative flag lives on the Go realtime service
 * (`RECORDING_ENABLED`, `services/realtime/cmd/server/config.go`): that is the
 * process that starts — or refuses to start — an egress. This candidate-app
 * read MIRRORS it so the candidate-facing copy (the privacy notice's recording
 * blocks, and the v3 consent variant pair) describes what will actually happen.
 *
 * **The two env vars must be set together, from the same deployment config**,
 * under the same name on purpose so a reader of one finds the other.
 *
 * A mismatch cannot open a hole. The Go consent-version gate accepts only the
 * recording-consent ids (`audioRecordingConsentCopyVersions`), and the
 * no-recording ids are never in that list: a service with recording ON facing a
 * candidate app with the flag OFF stamps a no-recording consent version, and
 * the service then declines to record. The mismatch fails CLOSED (no recording,
 * accurate copy), never unsafely open (a recording the candidate was not told
 * about).
 *
 * Split in two on purpose: `parseRecordingEnabled` is the pure rule, testable
 * without touching the ambient environment, and `isRecordingActive` is the one
 * env read. Server-only — never call it from a client component, or the flag
 * would be resolved on a machine that does not hold the deployment config.
 */

/**
 * The truthy spellings the Go service accepts (`recordingEnabled` in
 * `config.go`): case-folded "1", "true", "yes". Everything else — including a
 * missing, empty, or unparseable value — is off. Fail-closed: an unreadable
 * flag must describe the smaller processing, never the larger one.
 */
export function parseRecordingEnabled(
  value: string | null | undefined,
): boolean {
  switch ((value ?? "").trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    default:
      return false;
  }
}

export function isRecordingActive(): boolean {
  try {
    return parseRecordingEnabled(process.env.RECORDING_ENABLED);
  } catch {
    // An environment that cannot be read is an environment we cannot claim
    // recording from. Same fail-closed direction as an absent flag.
    return false;
  }
}
