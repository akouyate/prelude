package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/akouyate/prelude/services/realtime/internal/application"
	"github.com/akouyate/prelude/services/realtime/internal/domain"
)

type Server struct {
	service *application.Service
	mux     *http.ServeMux
}

func NewServer(service *application.Service) *Server {
	server := &Server{
		service: service,
		mux:     http.NewServeMux(),
	}
	server.routes()
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("POST /v1/interview-sessions", s.handleCreateSession)
	s.mux.HandleFunc("GET /v1/interview-sessions/{session_id}", s.handleGetSession)
	s.mux.HandleFunc("GET /v1/interview-sessions/{session_id}/agent-config", s.handleGetAgentConfig)
	s.mux.HandleFunc("POST /v1/interview-sessions/{session_id}/events", s.handleIngestEvent)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "prelude-realtime",
	})
}

type createSessionRequest struct {
	InterviewPlanID   string            `json:"interview_plan_id"`
	CandidateID       string            `json:"candidate_id"`
	AllowedModalities []domain.Modality `json:"allowed_modalities"`
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var request createSessionRequest
	if err := readJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}

	output, err := s.service.CreateSession(r.Context(), application.CreateSessionInput{
		InterviewPlanID:   request.InterviewPlanID,
		CandidateID:       request.CandidateID,
		AllowedModalities: request.AllowedModalities,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, output)
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	session, err := s.service.GetSession(r.Context(), r.PathValue("session_id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]domain.Session{"session": session})
}

func (s *Server) handleGetAgentConfig(w http.ResponseWriter, r *http.Request) {
	config, err := s.service.GetAgentConfig(r.Context(), r.PathValue("session_id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, config)
}

type ingestEventRequest struct {
	EventID        string            `json:"event_id"`
	SessionID      string            `json:"session_id"`
	Type           domain.EventType  `json:"type"`
	Actor          domain.EventActor `json:"actor"`
	Sequence       int               `json:"sequence"`
	IdempotencyKey string            `json:"idempotency_key"`
	OccurredAt     string            `json:"occurred_at"`
	Payload        json.RawMessage   `json:"payload"`
}

func (s *Server) handleIngestEvent(w http.ResponseWriter, r *http.Request) {
	var request ingestEventRequest
	if err := readJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}

	occurredAt, err := parseOptionalTime(request.OccurredAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_time", "occurred_at must be RFC3339")
		return
	}

	sessionID := r.PathValue("session_id")
	if strings.TrimSpace(request.SessionID) != "" && request.SessionID != sessionID {
		writeError(w, http.StatusBadRequest, "session_mismatch", "body session_id must match path session_id")
		return
	}

	output, err := s.service.IngestEvent(r.Context(), application.IngestEventInput{
		SessionID:      sessionID,
		EventID:        request.EventID,
		Type:           request.Type,
		Actor:          request.Actor,
		Sequence:       request.Sequence,
		IdempotencyKey: request.IdempotencyKey,
		OccurredAt:     occurredAt,
		Payload:        request.Payload,
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}

	status := http.StatusAccepted
	if output.Duplicate {
		status = http.StatusOK
	}
	writeJSON(w, status, output)
}

func readJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, application.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "invalid_input", err.Error())
	case errors.Is(err, application.ErrInvalidEvent):
		writeError(w, http.StatusUnprocessableEntity, "invalid_event", err.Error())
	case errors.Is(err, application.ErrSessionNotFound):
		writeError(w, http.StatusNotFound, "session_not_found", err.Error())
	case errors.Is(err, application.ErrEventConflict):
		writeError(w, http.StatusConflict, "event_conflict", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "unexpected error")
	}
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, map[string]map[string]string{
		"error": {
			"code":    code,
			"message": message,
		},
	})
}

func parseOptionalTime(value string) (domainTime, error) {
	if strings.TrimSpace(value) == "" {
		return domainTime{}, nil
	}

	return parseRFC3339(value)
}
