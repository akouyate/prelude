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

func containsConfigKey(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
