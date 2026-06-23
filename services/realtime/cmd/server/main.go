package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/httpapi"
	"github.com/akouyate/prelude/services/realtime/internal/adapters/livekit"
	"github.com/akouyate/prelude/services/realtime/internal/adapters/redisqueue"
	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Fail fast in production rather than silently degrade to an in-memory store,
	// a mock LiveKit gateway, or no agent dispatch.
	if isProduction(os.Getenv) {
		if missing := missingProductionConfig(os.Getenv); len(missing) > 0 {
			slog.Error("refusing to start in production without required config", "missing", missing)
			os.Exit(1)
		}
	}

	repository := application.SessionRepository(store.NewMemoryStore())
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		postgresStore, err := store.NewPostgresStore(context.Background(), databaseURL)
		if err != nil {
			slog.Error("failed to connect postgres store", "error", err)
			os.Exit(1)
		}
		defer func() {
			if err := postgresStore.Close(); err != nil {
				slog.Warn("failed to close postgres store", "error", err)
			}
		}()
		repository = postgresStore
		slog.Info("using postgres session repository")
	} else {
		slog.Info("using in-memory session repository")
	}

	livekitGateway, livekitMode, err := livekit.NewGatewayFromEnv(
		os.Getenv("LIVEKIT_URL"),
		os.Getenv("LIVEKIT_API_KEY"),
		os.Getenv("LIVEKIT_API_SECRET"),
		os.Getenv("APP_ENV") == "production",
	)
	if err != nil {
		slog.Error("failed to configure livekit gateway", "error", err)
		os.Exit(1)
	}
	slog.Info("using livekit gateway", "mode", livekitMode)
	service := application.NewService(repository, livekitGateway, application.SystemClock{})
	if provider := os.Getenv("LIVE_INTERVIEW_PROVIDER"); provider != "" {
		service.SetProvider(provider)
		slog.Info("using live interview provider", "provider", provider)
	}
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		dispatcher, err := redisqueue.NewAgentJoinDispatcher(context.Background(), redisqueue.AgentJoinDispatcherConfig{
			URL:       redisURL,
			StreamKey: os.Getenv("AGENT_JOIN_STREAM_KEY"),
		})
		if err != nil {
			slog.Error("failed to configure redis agent dispatcher", "error", err)
			os.Exit(1)
		}
		defer func() {
			if err := dispatcher.Close(); err != nil {
				slog.Warn("failed to close redis agent dispatcher", "error", err)
			}
		}()
		service.SetAgentDispatchQueue(dispatcher)
		slog.Info("using redis agent dispatcher")
	}
	var egressWebhookParser httpapi.EgressWebhookParser
	if recordingEnabled(os.Getenv) {
		realGateway, gatewayOK := livekitGateway.(*livekit.RealGateway)
		recordings, recordingsOK := repository.(application.RecordingRepository)
		consent, consentOK := repository.(application.RecordingConsentGate)
		switch {
		case !gatewayOK:
			slog.Warn("RECORDING_ENABLED set but the live LiveKit gateway is unavailable; recording stays off")
		case !recordingsOK || !consentOK:
			slog.Warn("RECORDING_ENABLED set but the session store does not support recording; recording stays off")
		default:
			region := os.Getenv("EGRESS_R2_REGION")
			if region == "" {
				region = "auto"
			}
			realGateway.ConfigureEgress(livekit.EgressTarget{
				Bucket:    os.Getenv("EGRESS_R2_BUCKET"),
				Region:    region,
				Endpoint:  os.Getenv("EGRESS_R2_ENDPOINT"),
				AccessKey: os.Getenv("EGRESS_R2_ACCESS_KEY_ID"),
				Secret:    os.Getenv("EGRESS_R2_SECRET_ACCESS_KEY"),
			})
			service.SetEgressGateway(realGateway)
			service.SetRecordingRepository(recordings)
			service.SetRecordingConsentGate(consent)

			parser, err := livekit.NewWebhookParser(os.Getenv("LIVEKIT_API_KEY"), os.Getenv("LIVEKIT_API_SECRET"))
			if err != nil {
				slog.Error("failed to configure egress webhook parser", "error", err)
				os.Exit(1)
			}
			egressWebhookParser = parser
			slog.Info("interview audio recording enabled")
		}
	}

	handler := httpapi.NewServer(service)
	if egressWebhookParser != nil {
		handler.SetEgressWebhookParser(egressWebhookParser)
		go runRecordingReconciler(context.Background(), service)
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	slog.Info("starting prelude realtime api", "addr", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

const (
	recordingReconcileInterval = 5 * time.Minute
	recordingStaleAfter        = 10 * time.Minute
)

// runRecordingReconciler periodically finalizes recordings whose egress_ended
// webhook never arrived, by polling LiveKit for each stale in-flight recording.
// It is the backstop for the webhook path, and it lets local dev finalize
// recordings without exposing a public webhook URL.
func runRecordingReconciler(ctx context.Context, service *application.Service) {
	ticker := time.NewTicker(recordingReconcileInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cutoff := time.Now().UTC().Add(-recordingStaleAfter)
			if reconciled, err := service.ReconcileRecordings(ctx, cutoff); err != nil {
				slog.Warn("recording reconciliation failed", "error", err)
			} else if reconciled > 0 {
				slog.Info("reconciled recordings", "count", reconciled)
			}
		}
	}
}
