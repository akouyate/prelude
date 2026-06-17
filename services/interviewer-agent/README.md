# Prelude Interviewer Agent

Python POC runtime for the live IA interviewer in epic #11.

This service owns the interviewer behavior only. It does not own recruiter UI,
candidate UI, Go session orchestration, LiveKit infrastructure, or provider
credentials.

## Boundaries

- `app/domain`: interview plan models, event contracts, interviewer state machine.
- `app/application`: orchestration use cases and ports.
- `app/adapters`: mock OpenAI Realtime provider and Go Realtime API client.
- `app/cli.py`: local simulation that emits events to stdout or the Go API.

## Why Python for the POC

The riskiest part is the live interviewer behavior: turn-taking, silence,
follow-ups, transcripts, and provider experimentation. Python keeps the agent
runtime easy to iterate while the Go service remains the product control plane.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run a local simulation

```bash
python -m app.cli --session-id demo-session
```

Events are printed as JSON lines when no Go API URL is provided.

To emit to the Go Realtime API:

```bash
python -m app.cli \
  --session-id demo-session \
  --realtime-api-url http://localhost:8080 \
  --api-key local-dev-token
```

Expected endpoint contract:

```text
POST /v1/interview-sessions/{session_id}/events
```

The Go API should treat events as append-only, idempotent records keyed by
`idempotency_key`.

## Test

```bash
pytest
```

## Next wiring steps

1. Replace `MockOpenAIRealtimeAdapter` with a real OpenAI Realtime adapter.
2. Add a LiveKit room participant adapter.
3. Add provider latency and cost metrics around every provider call.
4. Persist provider metadata in the event payloads without leaking secrets.

