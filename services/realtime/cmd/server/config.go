package main

import (
	"net/url"
	"strconv"
	"strings"
)

// defaultRecordingRetentionDays is the audio retention window when
// RECORDING_RETENTION_DAYS is unset — 90 days, matching the candidate consent
// copy ("kept for up to 90 days, then permanently deleted").
const defaultRecordingRetentionDays = 90

// recordingRetentionDays is the audio retention window in days. It defaults to 90
// and falls back to the default for an unparseable or negative value; "0"
// disables the retention sweep (audio is then kept until erased by request).
func recordingRetentionDays(getenv func(string) string) int {
	raw := strings.TrimSpace(getenv("RECORDING_RETENTION_DAYS"))
	if raw == "" {
		return defaultRecordingRetentionDays
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days < 0 {
		return defaultRecordingRetentionDays
	}

	return days
}

// recordingRetentionDisabled reports whether audio recording is enabled but the
// retention sweep is turned off (RECORDING_RETENTION_DAYS=0). That combination
// records candidate audio while never auto-deleting it, contradicting the
// consent copy ("kept up to 90 days, then permanently deleted"), so production
// must refuse to boot in that state. "0=off" stays available for local dev.
func recordingRetentionDisabled(getenv func(string) string) bool {
	return recordingEnabled(getenv) && recordingRetentionDays(getenv) == 0
}

// requiredProductionConfig lists the env vars the realtime service must have in
// production. Without them it would silently degrade to an in-memory store (data
// loss on restart), a mock LiveKit gateway, or no agent dispatch (agents never
// join) — none acceptable for a real candidate interview.
var requiredProductionConfig = []string{
	"DATABASE_URL",
	"REDIS_URL",
	"LIVEKIT_URL",
	"LIVEKIT_API_KEY",
	"LIVEKIT_API_SECRET",
	// Shared secret the HTTP API verifies on inbound calls; without it the API
	// (events ingestion, recruiter reads, the destructive recordings-erasure
	// endpoint) would serve unauthenticated. The server disables auth only when
	// this is empty, so production must require it.
	"REALTIME_API_KEY",
}

// recordingRequiredConfig lists the extra env vars needed once audio recording
// is enabled (RECORDING_ENABLED). EGRESS_R2_REGION defaults to "auto", so it is
// not required. The webhook verifier reuses LIVEKIT_API_KEY/SECRET.
var recordingRequiredConfig = []string{
	"EGRESS_R2_BUCKET",
	"EGRESS_R2_ENDPOINT",
	"EGRESS_R2_ACCESS_KEY_ID",
	"EGRESS_R2_SECRET_ACCESS_KEY",
}

func isProduction(getenv func(string) string) bool {
	return getenv("APP_ENV") == "production"
}

// recordingEnabled reports whether interview audio recording is turned on. It is
// off by default; recording is opt-in and gated behind this flag.
func recordingEnabled(getenv func(string) string) bool {
	switch strings.ToLower(strings.TrimSpace(getenv("RECORDING_ENABLED"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// euR2Regions are the EGRESS_R2_REGION values that attest EU placement for the
// recording bucket: Cloudflare's "eu" jurisdiction plus its two European
// location hints ("weur"/"eeur"). The remaining R2 hints (wnam, enam, apac, oc)
// and the "us"/"fedramp" jurisdictions all place data outside the EU.
var euR2Regions = map[string]bool{
	"eu":   true,
	"weur": true,
	"eeur": true,
}

// euR2EndpointSuffix is the host suffix of Cloudflare's EU-jurisdiction S3
// endpoint, https://<account_id>.eu.r2.cloudflarestorage.com. A jurisdictional
// bucket is the only R2 feature that *guarantees* objects are stored and
// processed inside the EU, and the jurisdiction is carried by the endpoint host
// rather than by any region string — so this is the strongest EU-residency fact
// that is visible from configuration alone, at boot.
const euR2EndpointSuffix = ".eu.r2.cloudflarestorage.com"

// isEUJurisdictionEndpoint reports whether an S3 endpoint addresses Cloudflare's
// EU jurisdiction. It matches on the host suffix, never as a substring, so a
// lookalike host (acct.eu.r2.cloudflarestorage.com.example.net) cannot pass.
func isEUJurisdictionEndpoint(raw string) bool {
	endpoint := strings.ToLower(strings.TrimSpace(raw))
	if endpoint == "" {
		return false
	}

	// Tolerate a scheme-less endpoint; url.Parse would read it as a path.
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}

	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}

	return strings.HasSuffix(parsed.Hostname(), euR2EndpointSuffix)
}

// recordingStorageOutsideEU reports whether audio recording is enabled while
// nothing in the egress configuration attests that the bucket lives in the EU.
// Every candidate is told their recording is stored in the European Union
// («stockés dans l'Union européenne»), so a destination that does not attest EU
// placement must refuse to boot rather than quietly store candidate audio
// wherever Cloudflare lands it. EGRESS_R2_REGION defaults to "auto", which is
// exactly that unspecified case, so the default is refused: fail closed.
//
// EU placement is attested by either
//   - EGRESS_R2_ENDPOINT addressing the "eu" jurisdiction (the binding
//     guarantee, and the shape production is expected to run), or
//   - EGRESS_R2_REGION naming an EU value, for a non-jurisdictional bucket or
//     for S3-compatible storage that is not R2 at all.
//
// Residual gap — this validates the operator's *declared* destination, not the
// bucket's observed placement, and it cannot be tightened to the endpoint alone:
//
//   - R2's S3 API requires the region "auto" (empty and "us-east-1" alias to
//     it), so EGRESS_R2_REGION is a signing region, not a placement fact. An
//     EU-jurisdiction deployment legitimately leaves it at "auto".
//   - An R2 location hint is best-effort placement, not a guarantee; only the
//     jurisdiction binds.
//
// So an operator can still point an EU-looking config at a bucket that was
// created elsewhere. The bucket's real jurisdiction must be confirmed once, by
// hand, against the Cloudflare dashboard — that step is mandatory in
// docs/operations/production-go-live-runbook.md.
func recordingStorageOutsideEU(getenv func(string) string) bool {
	if !recordingEnabled(getenv) {
		return false
	}

	if euR2Regions[strings.ToLower(strings.TrimSpace(getenv("EGRESS_R2_REGION")))] {
		return false
	}

	return !isEUJurisdictionEndpoint(getenv("EGRESS_R2_ENDPOINT"))
}

// missingProductionConfig returns the required env vars that are absent, so the
// service can fail fast in production instead of silently degrading. When
// recording is enabled it additionally requires the R2 egress destination, so a
// half-configured recording setup never boots in production.
func missingProductionConfig(getenv func(string) string) []string {
	required := requiredProductionConfig
	if recordingEnabled(getenv) {
		required = append(append([]string{}, requiredProductionConfig...), recordingRequiredConfig...)
	}

	var missing []string
	for _, key := range required {
		if getenv(key) == "" {
			missing = append(missing, key)
		}
	}

	return missing
}
