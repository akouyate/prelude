# Prelude Interviewer Agent

Python POC runtime for the live IA interviewer in epic #11.

This service owns the interviewer behavior only. It does not own recruiter UI,
candidate UI, Go session orchestration, LiveKit infrastructure, or provider
credentials.

## Boundaries

- `app/domain`: interview plan models, event contracts, deterministic
  `InterviewOrchestrator`, and interviewer state machine.
- `app/application`: orchestration use cases and ports that execute domain
  commands against providers and the Go API.
- `app/adapters`: mock OpenAI Realtime provider, Go Realtime API client, and LiveKit room adapter.
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

To smoke-test mocked interruption handling:

```bash
python -m app.cli \
  --session-id demo-session \
  --simulate-barge-in
```

The first question emits `barge_in_detected`, `barge_in_accepted`, and
`agent_speech_interrupted` without requiring a real media provider.

## Run provider benchmark scenarios

Issue #19 adds a repeatable benchmark harness for comparing provider behavior
without changing the production UI. It runs the same interview plan and
candidate scenario across providers, emits normalized events through the same
runner, and attaches benchmark metadata to every event.

Local deterministic smoke:

```bash
python -m app.benchmark_cli \
  --provider mock_openai_realtime \
  --scenario normal \
  --iterations 3 \
  --benchmark-run-id local-openai-smoke
```

From the repository root, the same smoke is available through:

```bash
make agent-benchmark \
  BENCHMARK_PROVIDER=mock_openai_realtime \
  BENCHMARK_SCENARIO=normal \
  BENCHMARK_ITERATIONS=3 \
  BENCHMARK_RUN_ID=local-openai-smoke
```

Persist events through the Go Realtime API:

```bash
python -m app.benchmark_cli \
  --provider mock_openai_realtime \
  --scenario repeat \
  --iterations 3 \
  --benchmark-run-id local-repeat-smoke \
  --realtime-api-url http://localhost:8080 \
  --api-key "$REALTIME_API_KEY" \
  --output-json benchmark-repeat.json
```

When `--realtime-api-url` is provided, the benchmark creates one Go realtime
session per iteration and then emits events to the generated session id. The
candidate id is deterministic for the benchmark run:
`benchmark-candidate-{benchmark_run_id}-{iteration}`.

Supported scenarios:

- `normal`
- `interrupt`
- `repeat`
- `silence`
- `vague`
- `noise`
- `audio_only`
- `video_enabled`
- `absurd_answer`
- `off_topic`
- `low_information`
- `contradictory`
- `generic_claim`
- `cmo`
- `buyer`
- `hr`
- `ai_orchestrator`
- `cmo_vague`
- `buyer_off_topic`
- `hr_contradictory`
- `ai_orchestrator_low_information`

To run the role-style matrix in one pass:

```bash
make agent-role-benchmark BENCHMARK_ITERATIONS=1
```

This runs the clear-answer CMO, buyer, HR, and AI orchestrator scenarios, then
the role-specific weak-answer scenarios that verify the interviewer challenges a
vague, off-topic, contradictory, or low-information answer before moving on.

Supported provider names:

- `mock_openai_realtime`: deterministic local harness validation.
- `openai_realtime`: credential-gated real-provider path.
- `elevenlabs`: credential-gated challenger path.

Real provider runs are blocked by default so automated tests and CI cannot spend
provider credits accidentally. To run a paid/provider-backed benchmark, pass
`--allow-live-llm-tests` or set `ALLOW_LIVE_LLM_TESTS=1` in the shell. The run
also requires credentials and a LiveKit-enabled worker session:

```bash
ALLOW_LIVE_LLM_TESTS="1"
LIVEKIT_URL="wss://..."
LIVEKIT_API_KEY="..."
LIVEKIT_API_SECRET="..."
OPENAI_API_KEY="..."
OPENAI_REALTIME_MODEL="gpt-realtime"
OPENAI_REALTIME_VOICE="marin"
OPENAI_REALTIME_TURN_DETECTION="semantic_vad"
OPENAI_REALTIME_REASONING_EFFORT="low"

ELEVENLABS_API_KEY="..."
ELEVENLABS_AGENT_ID="..."
ELEVENLABS_VOICE_ID="..."
ELEVENLABS_CONVERSATION_MODE="speech_engine"
ELEVENLABS_TURN_EAGERNESS="normal"
```

OpenAI Realtime smoke runs must persist through the Go Realtime API because
issue #31 verifies end-to-end event ingestion and transcript reconstruction:

```bash
make agent-benchmark \
  BENCHMARK_PROVIDER=openai_realtime \
  BENCHMARK_SCENARIO=normal \
  BENCHMARK_ITERATIONS=1 \
  BENCHMARK_RUN_ID=openai-livekit-smoke \
  BENCHMARK_PERSIST_REALTIME=1 \
  ALLOW_LIVE_LLM_TESTS=1
```

The equivalent direct CLI command is:

```bash
python -m app.benchmark_cli \
  --provider openai_realtime \
  --scenario normal \
  --iterations 1 \
  --benchmark-run-id openai-livekit-smoke \
  --realtime-api-url http://localhost:8080 \
  --allow-live-llm-tests
```

The OpenAI smoke creates a Go interview session, mints an agent LiveKit token
from `LIVEKIT_*`, joins the `prelude-{session_id}` room, opens an OpenAI
Realtime session handshake, then runs a deterministic candidate scenario through
Prelude's state machine. Candidate answers are still scripted in this POC so the
benchmark remains reproducible until the candidate browser/mobile media path is
implemented.

The harness fails with an actionable blocker when required provider variables
are missing. Provider-specific raw IDs and timing details should stay in
`provider_metadata`; business events must remain provider-neutral. Never put
OpenAI API keys, LiveKit API secrets, or LiveKit join tokens in reports or
metadata.

## Join a mocked LiveKit room from Go config

Start the Go Realtime API, create a session, then run:

```bash
python -m app.cli \
  --session-id {session_id} \
  --realtime-api-url http://localhost:8080 \
  --join-livekit
```

The worker calls:

```text
GET /v1/interview-sessions/{session_id}/agent-config
```

For `mock_lk_*` tokens the LiveKit adapter records a local join and does not
require a running LiveKit server. With a real token, it imports the LiveKit SDK
at join time and connects to the provided room URL.

## Run the OpenAI live worker from Make

After the candidate app creates a Go realtime session and emits both
`candidate_joined` and `candidate_media_ready`, run the OpenAI-only worker from
the repository root:

```bash
make live-openai-worker SESSION_ID={session_id}
```

For the normal local live flow, prefer the Redis-backed auto-worker:

```bash
make env-up
make live-openai-autoworker
```

With `REDIS_URL` configured on the Go realtime API, the API publishes an agent
join job to a Redis Stream after `candidate_media_ready`. The auto-worker
consumes that stream, verifies the session still needs an agent through the Go
API, then runs the same per-session OpenAI worker. The manual
`live-openai-worker` target remains useful as a debug fallback.

The target loads `.env`, requires `REALTIME_API_URL`, fetches:

```text
GET /v1/interview-sessions/{session_id}/agent-config
```

The returned `interview_plan.interview_style` gives the live interviewer
structured context for sector, seniority, work environment, role constraints,
company context, and candidate tone. The worker uses that context before
falling back to inference from the role title and planned questions.

Then the worker waits for the candidate readiness event, joins the LiveKit room
as `agent-{session_id}`, starts a LiveKit Agents `AgentSession` with OpenAI
Realtime, publishes the interviewer audio back into the same room, listens to
candidate microphone audio, and persists normalized Prelude events and
transcript turns back to the Go API.

Question progression is owned by Prelude's deterministic
`InterviewOrchestrator`, not by the realtime model. The worker disables automatic
provider responses where supported, emits `candidate_turn_finalized`, then emits
`answer_evaluated` before it repeats, waits, soft-reprompts, asks a bounded
follow-up, completes the question, asks the next planned question, or closes the
session. The model remains responsible for speech generation and transcription
support inside those bounded commands.

Live answer analysis can be LLM-assisted while keeping the deterministic
orchestrator as the policy owner. When `OPENAI_ANSWER_INFERENCE_ENABLED=1` and
`OPENAI_API_KEY` is present, the worker calls the configured
`OPENAI_ANSWER_INFERENCE_MODEL` with a short timeout and records
`evaluation_matrix.evaluator_mode = "llm_assisted"`. If the LLM call fails or
times out, the worker falls back to the local heuristic evaluator so the
interview can continue.

The implementation and compliance sources for the evaluation matrix are tracked
in [`../../docs/sources/evaluation-matrix.md`](../../docs/sources/evaluation-matrix.md).

For a bounded real-provider smoke:

```bash
make live-openai-worker \
  SESSION_ID={session_id} \
  LIVE_WORKER_MAX_DURATION_SECONDS=15 \
  LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS=120 \
  LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS=10
```

Manual desktop/mobile smoke:

1. Start Go realtime API and the candidate app.
2. Open `/interview/demo-token` in the browser or on the mobile LAN URL.
3. Start the live interview and allow microphone access.
4. Confirm Go has `candidate_joined` and `candidate_media_ready` events for the
   session.
5. Start `make live-openai-worker SESSION_ID={session_id}`.
6. Confirm the candidate hears interviewer audio and `/transcript` contains the
   interviewer turn, then candidate turns after speech is transcribed.
7. Stay silent after the first question and confirm the worker emits
   `silence_timeout_started`, `answer_evaluated`, and `soft_reprompted`, then
   the interviewer asks whether there is a technical issue or whether the
   candidate needs a moment.

For a local room/join smoke without calling OpenAI:

```bash
make live-openai-worker \
  SESSION_ID={session_id} \
  LIVE_WORKER_SKIP_OPENAI=1
```

When testing against a non-default Go port, override the URL:

```bash
make live-openai-worker \
  SESSION_ID={session_id} \
  REALTIME_API_URL=http://127.0.0.1:18080
```

## Test

```bash
pytest
```

## Next wiring steps

1. Drive question-level state from LiveKit/OpenAI conversation callbacks instead
   of relying on prompt instructions alone.
2. Map provider turn-taking signals into `TurnTakingPolicy` instead of letting
   provider callbacks advance interview state directly.
3. Add provider latency and cost metrics around every provider call.
4. Run the same scenario set against OpenAI Realtime and ElevenLabs before
   choosing the commercial POC provider.
