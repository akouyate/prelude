# Prelude Realtime API

Prelude Realtime API is the POC control plane for live IA interviews.

It owns product/session orchestration and keeps media/provider details behind
ports so the POC can start with mocked LiveKit behavior, then swap in real room
and token creation without changing HTTP contracts.

## Scope

- Health endpoint.
- Create interview session.
- Return mocked LiveKit join responses for candidate and agent participants.
- Ingest realtime events idempotently in memory.
- Fetch a session with its ingested events.
- Serve the Python worker config for a mocked InterviewPlan.

Out of scope for this POC:

- Persistent database.
- Real LiveKit SDK integration.
- Authentication and authorization.
- Billing, recording, and provider calls.

## Architecture

```text
cmd/server
internal/domain
internal/application
internal/adapters/httpapi
internal/adapters/livekit
internal/adapters/store
```

The service follows a lightweight clean architecture:

- `domain`: session and event entities.
- `application`: orchestration use cases and ports.
- `adapters/httpapi`: standard-library HTTP handlers.
- `adapters/livekit`: mocked LiveKit room/token adapter.
- `adapters/store`: in-memory repository.

## Run

```bash
go run ./cmd/server
```

The server listens on `:8080` by default. Override with:

```bash
PORT=8081 go run ./cmd/server
```

## HTTP API

```bash
curl http://localhost:8080/health
```

```bash
curl -X POST http://localhost:8080/v1/interview-sessions \
  -H 'content-type: application/json' \
  -d '{
    "interview_plan_id": "plan_123",
    "candidate_id": "cand_123",
    "allowed_modalities": ["audio", "video"]
  }'
```

```bash
curl http://localhost:8080/v1/interview-sessions/{session_id}
```

```bash
curl http://localhost:8080/v1/interview-sessions/{session_id}/agent-config
```

```bash
curl -X POST http://localhost:8080/v1/interview-sessions/{session_id}/events \
  -H 'content-type: application/json' \
  -d '{
    "event_id": "evt_123",
    "type": "session_started",
    "actor": "agent",
    "sequence": 1,
    "idempotency_key": "session_123:session_started:1",
    "payload": {"provider": "mock"}
  }'
```

## Validate

```bash
go test ./...
```
