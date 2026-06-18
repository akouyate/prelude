# Prelude Realtime API

Prelude Realtime API is the POC control plane for live IA interviews.

It owns product/session orchestration and keeps media/provider details behind
ports so the POC can start with mocked LiveKit behavior, then swap in real room
and token creation without changing HTTP contracts.

## Scope

- Health endpoint.
- Create interview session.
- Return LiveKit join responses for candidate and agent participants.
- Ingest realtime events idempotently.
- Persist sessions and append-only events in Postgres when `DATABASE_URL` is set.
- Fetch a session with its ingested events.
- Reconstruct candidate transcript turns from finalized turn events.
- Serve the Python worker config for a mocked InterviewPlan with structured
  interview style context.

Out of scope for this POC:

- LiveKit room lifecycle management beyond token minting.
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
- `adapters/livekit`: LiveKit room/token adapter with mock fallback.
- `adapters/store`: in-memory and Postgres repositories.

## Run

```bash
go run ./cmd/server
```

The server listens on `:8080` by default. Override with:

```bash
PORT=8081 go run ./cmd/server
```

By default, the server uses the in-memory store. To use durable Postgres storage,
start the local database from the repository root and run with `DATABASE_URL`:

```bash
make env-up
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prelude?schema=public" go run ./cmd/server
```

By default, LiveKit joins are mocked so local development works offline. To mint
real candidate and agent LiveKit JWT join tokens, provide all LiveKit variables
server-side:

```bash
LIVEKIT_URL="wss://..."
LIVEKIT_API_KEY="..."
LIVEKIT_API_SECRET="..."
go run ./cmd/server
```

Do not expose `LIVEKIT_API_SECRET` to browser code. Browser clients should only
receive short-lived join tokens returned by this API.

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

The agent config includes `interview_plan.interview_style`, which carries
structured guidance such as sector, seniority, work environment, role
constraints, company context, and candidate tone. The Python live interviewer
uses this context before falling back to inference from the role title and
planned questions.

```bash
curl -X POST http://localhost:8080/v1/interview-sessions/{session_id}/events \
  -H 'content-type: application/json' \
  -d '{
    "event_id": "evt_123",
    "type": "session_started",
    "actor": "agent",
    "sequence_number": 1,
    "idempotency_key": "session_123:session_started:1",
    "payload": {"provider": "mock"},
    "provider_metadata": {"provider_event_id": "raw_provider_evt_123"}
  }'
```

```bash
curl http://localhost:8080/v1/interview-sessions/{session_id}/transcript
```

## Validate

```bash
go test ./...
```

Run Postgres integration tests from the repository root after applying migrations:

```bash
make env-up
make db-migrate
cd services/realtime
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/prelude?schema=public" go test ./...
```
