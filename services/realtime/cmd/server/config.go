package main

import "strings"

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
