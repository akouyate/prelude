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
		case "DATABASE_URL", "REDIS_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET":
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

func containsConfigKey(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
