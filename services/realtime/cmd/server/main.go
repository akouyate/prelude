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
	handler := httpapi.NewServer(service)

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
