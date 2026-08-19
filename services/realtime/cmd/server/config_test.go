package main

import "testing"

// In production the realtime service must refuse to start rather than silently
// degrade to an in-memory store (data loss), a mock LiveKit gateway, or no agent
// dispatch (agents never join). missingProductionConfig drives that fail-fast.
func TestMissingProductionConfigReportsAllAbsentRequiredVars(t *testing.T) {
	getenv := func(string) string { return "" }

	missing := missingProductionConfig(getenv)
	if len(missing) != len(requiredProductionConfig) {
		t.Fatalf("expected all %d required vars reported, got %v", len(requiredProductionConfig), missing)
	}

	for _, key := range []string{
		"DATABASE_URL",
		"REDIS_URL",
		"LIVEKIT_URL",
		"LIVEKIT_API_KEY",
		"LIVEKIT_API_SECRET",
		"REALTIME_API_KEY",
	} {
		if !containsConfigKey(missing, key) {
			t.Errorf("expected %q to be required in production", key)
		}
	}
}

func TestMissingProductionConfigEmptyWhenAllPresent(t *testing.T) {
	getenv := func(string) string { return "configured" }

	if missing := missingProductionConfig(getenv); len(missing) != 0 {
		t.Fatalf("expected no missing config, got %v", missing)
	}
}

func TestMissingProductionConfigRequiresR2WhenRecordingEnabled(t *testing.T) {
	getenv := func(key string) string {
		switch key {
		case "RECORDING_ENABLED":
			return "true"
		case "DATABASE_URL", "REDIS_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET":
			return "configured"
		default:
			return ""
		}
	}

	missing := missingProductionConfig(getenv)
	for _, key := range []string{
		"EGRESS_R2_BUCKET",
		"EGRESS_R2_ENDPOINT",
		"EGRESS_R2_ACCESS_KEY_ID",
		"EGRESS_R2_SECRET_ACCESS_KEY",
	} {
		if !containsConfigKey(missing, key) {
			t.Errorf("expected %q to be required when recording is enabled in production", key)
		}
	}
}

func TestMissingProductionConfigIgnoresR2WhenRecordingDisabled(t *testing.T) {
	getenv := func(key string) string {
		switch key {
		case "DATABASE_URL", "REDIS_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "REALTIME_API_KEY":
			return "configured"
		default:
			return ""
		}
	}

	if missing := missingProductionConfig(getenv); len(missing) != 0 {
		t.Fatalf("expected no missing config when recording is disabled, got %v", missing)
	}
}

func TestRecordingRetentionDays(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 90},        // default
		{"30", 30},      // explicit
		{"0", 0},        // disabled
		{"  45 ", 45},   // trimmed
		{"-5", 90},      // negative falls back to default
		{"notanum", 90}, // unparseable falls back to default
	}
	for _, c := range cases {
		got := recordingRetentionDays(func(string) string { return c.in })
		if got != c.want {
			t.Errorf("recordingRetentionDays(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestRecordingRetentionDisabled(t *testing.T) {
	withRecording := func(retention string) func(string) string {
		return func(key string) string {
			switch key {
			case "RECORDING_ENABLED":
				return "true"
			case "RECORDING_RETENTION_DAYS":
				return retention
			default:
				return ""
			}
		}
	}

	if !recordingRetentionDisabled(withRecording("0")) {
		t.Error("recording enabled + retention 0 must be flagged as disabled (it must not boot in prod)")
	}
	if recordingRetentionDisabled(withRecording("90")) {
		t.Error("recording enabled + an explicit retention window must be allowed")
	}
	if recordingRetentionDisabled(withRecording("")) {
		t.Error("recording enabled + default (90) retention must be allowed")
	}
	// Recording off: "0" retention is irrelevant — never flagged.
	if recordingRetentionDisabled(func(string) string { return "" }) {
		t.Error("recording disabled must never be flagged regardless of retention")
	}
}

func TestMissingProductionConfigRequiresRealtimeAPIKey(t *testing.T) {
	// REALTIME_API_KEY authenticates inbound calls to the realtime HTTP API
	// (events ingestion, recruiter reads, the destructive recordings-erasure
	// endpoint). Production must fail fast without it so the API is never served
	// unauthenticated.
	getenv := func(key string) string {
		switch key {
		case "DATABASE_URL", "REDIS_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET":
			return "configured"
		default:
			return ""
		}
	}

	if !containsConfigKey(missingProductionConfig(getenv), "REALTIME_API_KEY") {
		t.Error("REALTIME_API_KEY must be required in production so the realtime API is never unauthenticated")
	}
}

func containsConfigKey(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// The candidate consent tells every candidate their recording is stored in the
// European Union («stockés dans l'Union européenne»). Nothing in the config
// enforced that: EGRESS_R2_REGION defaults to "auto", which places the bucket
// wherever Cloudflare lands it. Recording must now refuse to boot in production
// unless the configuration attests EU placement — either through Cloudflare's
// EU-jurisdiction endpoint (the binding guarantee) or an explicit EU region.
func TestRecordingStorageOutsideEU(t *testing.T) {
	cases := []struct {
		name      string
		recording string
		region    string
		endpoint  string
		want      bool
	}{
		// Recording off: the consent promise is never made, nothing to guard.
		{
			name:      "recording disabled leaves an unset destination alone",
			recording: "0",
		},
		{
			name:      "recording disabled tolerates a US destination",
			recording: "0",
			region:    "enam",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
		},

		// The EU jurisdiction endpoint is the only R2 setting that *guarantees*
		// objects stay in the EU, and R2's S3 API requires region "auto", so this
		// is the shape production is expected to run.
		{
			name:      "eu jurisdiction endpoint passes with the mandatory auto region",
			recording: "1",
			region:    "auto",
			endpoint:  "https://acct.eu.r2.cloudflarestorage.com",
		},
		{
			name:      "eu jurisdiction endpoint passes with no region set",
			recording: "1",
			endpoint:  "https://acct.eu.r2.cloudflarestorage.com",
		},
		{
			name:      "eu jurisdiction endpoint is case- and space-insensitive",
			recording: "true",
			endpoint:  "  HTTPS://Acct.EU.R2.CloudflareStorage.com  ",
		},
		{
			name:      "eu jurisdiction endpoint passes without a scheme",
			recording: "yes",
			endpoint:  "acct.eu.r2.cloudflarestorage.com",
		},

		// An explicit EU region also attests placement, for a non-jurisdictional
		// bucket or S3-compatible storage that is not R2.
		{
			name:      "eu region passes on a generic endpoint",
			recording: "1",
			region:    "eu",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
		},
		{
			name:      "western europe hint passes",
			recording: "1",
			region:    "weur",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
		},
		{
			name:      "eastern europe hint passes",
			recording: "1",
			region:    "eeur",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
		},
		{
			name:      "eu region is case-insensitive and trimmed",
			recording: "1",
			region:    "  WEUR ",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
		},

		// Everything else is refused.
		{
			name:      "nothing configured is refused",
			recording: "1",
			want:      true,
		},
		{
			name:      "the auto default on a generic endpoint is refused",
			recording: "1",
			region:    "auto",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
			want:      true,
		},
		{
			name:      "eastern north america is refused",
			recording: "1",
			region:    "enam",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
			want:      true,
		},
		{
			name:      "the us jurisdiction endpoint is refused",
			recording: "1",
			region:    "auto",
			endpoint:  "https://acct.us.r2.cloudflarestorage.com",
			want:      true,
		},
		{
			name:      "the fedramp jurisdiction endpoint is refused",
			recording: "1",
			region:    "auto",
			endpoint:  "https://acct.fedramp.r2.cloudflarestorage.com",
			want:      true,
		},
		{
			name:      "an aws-style eu region is refused (it is not an R2 value)",
			recording: "1",
			region:    "eu-west-1",
			endpoint:  "https://acct.r2.cloudflarestorage.com",
			want:      true,
		},
		{
			// The EU endpoint must match on the host suffix, never as a substring,
			// so a lookalike host cannot smuggle the guard open.
			name:      "an eu-jurisdiction lookalike host is refused",
			recording: "1",
			region:    "auto",
			endpoint:  "https://acct.eu.r2.cloudflarestorage.com.example.net",
			want:      true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			getenv := func(key string) string {
				switch key {
				case "RECORDING_ENABLED":
					return testCase.recording
				case "EGRESS_R2_REGION":
					return testCase.region
				case "EGRESS_R2_ENDPOINT":
					return testCase.endpoint
				default:
					return ""
				}
			}

			got := recordingStorageOutsideEU(getenv)
			if got != testCase.want {
				t.Errorf("recordingStorageOutsideEU(recording=%q, region=%q, endpoint=%q) = %v, want %v",
					testCase.recording, testCase.region, testCase.endpoint, got, testCase.want)
			}
		})
	}
}
