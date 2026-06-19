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
		"candidate_id": "candidate_123",
		"type": "session_started",
		"actor": "agent",
		"sequence_number": 1,
		"idempotency_key": "evt_123:idempotency",
		"payload": {"source": "agent"},
		"provider_metadata": {"provider_event_id": "provider_evt_123"}
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
	if !bytes.Contains(getResponse.Body.Bytes(), []byte(`"candidate_id":"candidate_123"`)) {
		t.Fatalf("expected persisted candidate_id on event, got %s", getResponse.Body.String())
	}
	if !bytes.Contains(getResponse.Body.Bytes(), []byte(`"provider_metadata":{"provider_event_id":"provider_evt_123"}`)) {
		t.Fatalf("expected separated provider metadata, got %s", getResponse.Body.String())
	}
}

func TestServerReturnsAgentConfig(t *testing.T) {
	server := newTestServer()

	createResponse := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions", bytes.NewBufferString(`{
		"interview_plan_id": "plan_123",
		"candidate_id": "candidate_123"
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
		LiveKitJoin struct {
			Token string `json:"token"`
		} `json:"livekit_join"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &createBody); err != nil {
		t.Fatalf("failed to decode create response: %v", err)
	}

	configResponse := httptest.NewRecorder()
	configRequest := httptest.NewRequest(http.MethodGet, "/v1/interview-sessions/"+createBody.Session.ID+"/agent-config", nil)
	server.ServeHTTP(configResponse, configRequest)

	if configResponse.Code != http.StatusOK {
		t.Fatalf("expected config status 200, got %d: %s", configResponse.Code, configResponse.Body.String())
	}
	if !bytes.Contains(configResponse.Body.Bytes(), []byte(`"participant":"agent-`+createBody.Session.ID+`"`)) {
		t.Fatalf("expected agent participant in config, got %s", configResponse.Body.String())
	}
	if bytes.Contains(configResponse.Body.Bytes(), []byte(createBody.LiveKitJoin.Token)) {
		t.Fatal("agent config should not reuse the candidate token")
	}
	if !bytes.Contains(configResponse.Body.Bytes(), []byte(`"interview_plan"`)) {
		t.Fatalf("expected interview plan in config, got %s", configResponse.Body.String())
	}
	if !bytes.Contains(configResponse.Body.Bytes(), []byte(`"interview_style"`)) {
		t.Fatalf("expected interview style in config, got %s", configResponse.Body.String())
	}
	if !bytes.Contains(configResponse.Body.Bytes(), []byte(`"sector":"B2B SaaS"`)) {
		t.Fatalf("expected interview style sector in config, got %s", configResponse.Body.String())
	}
}

func TestServerRejectsMismatchedBodySessionID(t *testing.T) {
	server := newTestServer()

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions/session_path/events", bytes.NewBufferString(`{
		"event_id": "evt_123",
		"session_id": "session_body",
		"type": "session_started",
		"actor": "agent",
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

func TestServerReturnsTranscriptFromFinalizedTurns(t *testing.T) {
	server := newTestServer()

	createResponse := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions", bytes.NewBufferString(`{
		"interview_plan_id": "plan_123",
		"candidate_id": "candidate_123"
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

	for _, body := range []string{
		`{
			"event_id": "evt_started",
			"type": "session_started",
			"actor": "agent",
			"sequence_number": 1,
			"idempotency_key": "evt_started:idempotency",
			"payload": {"source": "agent"}
		}`,
		`{
			"event_id": "evt_turn",
			"type": "candidate_turn_finalized",
			"actor": "candidate",
			"sequence_number": 2,
			"idempotency_key": "evt_turn:idempotency",
			"payload": {
				"question_id": "q1",
				"completion_reason": "answered",
				"transcript_turn": {
					"turn_id": "turn_1",
					"session_id": "` + createBody.Session.ID + `",
					"question_id": "q1",
					"speaker": "candidate",
					"text": "Voici ma reponse courte.",
					"is_final": true,
					"started_at": "2026-06-17T10:00:05Z",
					"ended_at": "2026-06-17T10:00:08Z"
				}
			}
		}`,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions/"+createBody.Session.ID+"/events", bytes.NewBufferString(body))
		request.Header.Set("content-type", "application/json")
		server.ServeHTTP(response, request)
		if response.Code != http.StatusAccepted {
			t.Fatalf("expected event status 202, got %d: %s", response.Code, response.Body.String())
		}
	}

	transcriptResponse := httptest.NewRecorder()
	transcriptRequest := httptest.NewRequest(http.MethodGet, "/v1/interview-sessions/"+createBody.Session.ID+"/transcript", nil)
	server.ServeHTTP(transcriptResponse, transcriptRequest)

	if transcriptResponse.Code != http.StatusOK {
		t.Fatalf("expected transcript status 200, got %d: %s", transcriptResponse.Code, transcriptResponse.Body.String())
	}
	if !bytes.Contains(transcriptResponse.Body.Bytes(), []byte(`"text":"Voici ma reponse courte."`)) {
		t.Fatalf("expected transcript turn text, got %s", transcriptResponse.Body.String())
	}
}

func TestServerReturnsRecruiterSummary(t *testing.T) {
	server := newTestServer()

	createResponse := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions", bytes.NewBufferString(`{
		"interview_plan_id": "plan_123",
		"candidate_id": "candidate_123"
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

	for _, body := range []string{
		`{
			"event_id": "evt_started",
			"type": "session_started",
			"actor": "agent",
			"sequence_number": 1,
			"idempotency_key": "evt_started:idempotency",
			"payload": {"source": "agent"}
		}`,
		`{
			"event_id": "evt_turn",
			"type": "candidate_turn_finalized",
			"actor": "candidate",
			"sequence_number": 2,
			"idempotency_key": "evt_turn:idempotency",
			"payload": {
				"question_id": "q1",
				"completion_reason": "answered",
				"transcript_turn": {
					"turn_id": "turn_1",
					"session_id": "` + createBody.Session.ID + `",
					"question_id": "q1",
					"speaker": "candidate",
					"text": "Je veux travailler sur un produit B2B avec des clients exigeants et des arbitrages clairs.",
					"is_final": true,
					"started_at": "2026-06-17T10:00:05Z",
					"ended_at": "2026-06-17T10:00:08Z"
				}
			}
		}`,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions/"+createBody.Session.ID+"/events", bytes.NewBufferString(body))
		request.Header.Set("content-type", "application/json")
		server.ServeHTTP(response, request)
		if response.Code != http.StatusAccepted {
			t.Fatalf("expected event status 202, got %d: %s", response.Code, response.Body.String())
		}
	}

	summaryResponse := httptest.NewRecorder()
	summaryRequest := httptest.NewRequest(http.MethodGet, "/v1/interview-sessions/"+createBody.Session.ID+"/summary", nil)
	server.ServeHTTP(summaryResponse, summaryRequest)

	if summaryResponse.Code != http.StatusOK {
		t.Fatalf("expected summary status 200, got %d: %s", summaryResponse.Code, summaryResponse.Body.String())
	}
	if !bytes.Contains(summaryResponse.Body.Bytes(), []byte(`"summary_id":"rs_`+createBody.Session.ID+`"`)) {
		t.Fatalf("expected summary id, got %s", summaryResponse.Body.String())
	}
	if !bytes.Contains(summaryResponse.Body.Bytes(), []byte(`"recommendation"`)) {
		t.Fatalf("expected recommendation, got %s", summaryResponse.Body.String())
	}
	if !bytes.Contains(summaryResponse.Body.Bytes(), []byte(`"audit"`)) {
		t.Fatalf("expected audit metadata, got %s", summaryResponse.Body.String())
	}
}

func TestServerAcceptsAnswerEvaluatedEvent(t *testing.T) {
	server := newTestServer()

	createResponse := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions", bytes.NewBufferString(`{
		"interview_plan_id": "plan_123",
		"candidate_id": "candidate_123"
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

	for _, body := range []string{
		`{
			"event_id": "evt_started",
			"type": "session_started",
			"actor": "agent",
			"sequence_number": 1,
			"idempotency_key": "evt_started:idempotency",
			"payload": {"source": "agent"}
		}`,
		`{
			"event_id": "evt_answer_eval",
			"type": "answer_evaluated",
			"actor": "system",
			"sequence_number": 2,
			"idempotency_key": "evt_answer_eval:idempotency",
			"payload": {
				"question_id": "q1",
				"turn_ids": ["turn_1"],
				"attempt_index": 1,
				"classification": "vague",
				"reason_codes": ["too_generic"],
				"policy_action": "ask_followup",
				"confidence": 0.78,
				"evaluator_version": "answer-eval-v1"
			}
		}`,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/interview-sessions/"+createBody.Session.ID+"/events", bytes.NewBufferString(body))
		request.Header.Set("content-type", "application/json")
		server.ServeHTTP(response, request)
		if response.Code != http.StatusAccepted {
			t.Fatalf("expected event status 202, got %d: %s", response.Code, response.Body.String())
		}
	}
}

func newTestServer() *Server {
	repository := store.NewMemoryStore()
	livekitGateway := livekit.NewMockGateway("wss://livekit.example.test")
	service := application.NewService(repository, livekitGateway, nil)
	return NewServer(service)
}
