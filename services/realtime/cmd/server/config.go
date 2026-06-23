package main

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

func isProduction(getenv func(string) string) bool {
	return getenv("APP_ENV") == "production"
}

// missingProductionConfig returns the required env vars that are absent, so the
// service can fail fast in production instead of silently degrading.
func missingProductionConfig(getenv func(string) string) []string {
	var missing []string
	for _, key := range requiredProductionConfig {
		if getenv(key) == "" {
			missing = append(missing, key)
		}
	}

	return missing
}
