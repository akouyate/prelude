package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/httpapi"
	"github.com/akouyate/prelude/services/realtime/internal/adapters/livekit"
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
