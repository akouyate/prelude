package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/akouyate/prelude/services/realtime/internal/adapters/livekit"
	"github.com/akouyate/prelude/services/realtime/internal/adapters/store"
	"github.com/akouyate/prelude/services/realtime/internal/application"
)

func TestServerHealth(t *testing.T) {
	server := newTestServer()
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
}

func TestServerCreateGetAndIngestEvent(t *testing.T) {
	server := newTestServer()

	createResponse := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions", bytes.NewBufferString(`{
		"interview_plan_id": "plan_123",
		"candidate_id": "candidate_123",
		"allowed_modalities": ["audio", "video"]
	}`))
	createRequest.Header.Set("content-type", "application/json")
	server.ServeHTTP(createResponse, createRequest)

	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected create status 201, got %d: %s", createResponse.Code, createResponse.Body.String())
	}

	var createBody struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &createBody); err != nil {
		t.Fatalf("failed to decode create response: %v", err)
	}
	if createBody.Session.ID == "" {
		t.Fatal("expected session id")
	}

	eventResponse := httptest.NewRecorder()
	eventRequest := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions/"+createBody.Session.ID+"/events", bytes.NewBufferString(`{
		"event_id": "evt_123",
		"session_id": "`+createBody.Session.ID+`",
		"type": "session_started",
		"sequence": 1,
		"idempotency_key": "evt_123:idempotency",
		"payload": {"source": "agent"}
	}`))
	eventRequest.Header.Set("content-type", "application/json")
	server.ServeHTTP(eventResponse, eventRequest)

	if eventResponse.Code != http.StatusAccepted {
		t.Fatalf("expected event status 202, got %d: %s", eventResponse.Code, eventResponse.Body.String())
	}

	getResponse := httptest.NewRecorder()
	getRequest := httptest.NewRequest(http.MethodGet, "/v1/interview-sessions/"+createBody.Session.ID, nil)
	server.ServeHTTP(getResponse, getRequest)

	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected get status 200, got %d: %s", getResponse.Code, getResponse.Body.String())
	}
	if !bytes.Contains(getResponse.Body.Bytes(), []byte(`"status":"in_progress"`)) {
		t.Fatalf("expected in_progress session, got %s", getResponse.Body.String())
	}
}

func TestServerRejectsMismatchedBodySessionID(t *testing.T) {
	server := newTestServer()

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions/session_path/events", bytes.NewBufferString(`{
		"event_id": "evt_123",
		"session_id": "session_body",
		"type": "session_started",
		"sequence": 1,
		"idempotency_key": "evt_123:idempotency",
		"payload": {"source": "agent"}
	}`))
	request.Header.Set("content-type", "application/json")
	server.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", response.Code, response.Body.String())
	}
	if !bytes.Contains(response.Body.Bytes(), []byte(`"code":"session_mismatch"`)) {
		t.Fatalf("expected session_mismatch error, got %s", response.Body.String())
	}
}

func newTestServer() *Server {
	repository := store.NewMemoryStore()
	livekitGateway := livekit.NewMockGateway("wss://livekit.example.test")
	service := application.NewService(repository, livekitGateway, nil)
	return NewServer(service)
}
