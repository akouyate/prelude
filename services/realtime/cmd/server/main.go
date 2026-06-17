package main

import (
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

	repository := store.NewMemoryStore()
	livekitGateway := livekit.NewMockGateway(os.Getenv("LIVEKIT_URL"))
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
