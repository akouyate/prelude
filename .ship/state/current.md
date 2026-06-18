# Ship State

## Objective

Ship issue #31: OpenAI Realtime + LiveKit smoke for the live IA interviewer.

## Source

- Epic: https://github.com/akouyate/prelude/issues/11
- Provider foundation: https://github.com/akouyate/prelude/issues/19
- Current ticket: https://github.com/akouyate/prelude/issues/31
- LiveKit OpenAI Realtime docs: https://docs.livekit.io/agents/models/realtime/plugins/openai/
- OpenAI Realtime VAD docs: https://developers.openai.com/api/docs/guides/realtime-vad

## Phases

- [x] Intake
- [x] Repository investigation
- [x] Skill loading
- [x] Architecture review
- [x] Plan
- [x] Team decision
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [ ] Delivery

## Team

- Orchestrator: main Codex thread, owns integration, tests, docs, PR.
- Agents used:
  - Architecture explorer: challenged Go/Python/LiveKit/OpenAI boundaries.
  - Python provider explorer: challenged minimal OpenAI Realtime adapter and tests.

## Architecture Decision

- Keep Go Realtime API as the control plane: create sessions, ingest normalized events, reconstruct transcripts.
- Keep LiveKit Cloud as the media plane. The benchmark runner mints an agent token for `prelude-{session_id}` from local `LIVEKIT_*`.
- Keep Python `InterviewSessionRunner` as source of truth for interview progression and event sequencing.
- Add a real `openai_realtime` smoke provider that opens an OpenAI Realtime session handshake, records non-secret metadata, then runs deterministic candidate turns through Prelude's state machine.
- Require Go persistence for `openai_realtime` smoke runs because #31 acceptance includes transcript reconstruction from persisted events.
- Do not expose OpenAI API keys, LiveKit API secrets, or LiveKit join tokens in benchmark reports or `provider_metadata`.

## Validation

- `uv run --with-requirements requirements.txt python -m pytest -q` in `services/interviewer-agent`: 38 passed.
- `go test ./...` in `services/realtime`: 19 passed.
- `git diff --check`: passed.
- Mock smoke:
  - `make agent-benchmark BENCHMARK_PROVIDER=mock_openai_realtime BENCHMARK_SCENARIO=normal BENCHMARK_ITERATIONS=1 BENCHMARK_RUN_ID=smoke-mock-31`
  - Completed with 30 events and 3 completed questions.
- Real smoke:
  - Started `services/realtime` with `go run ./cmd/server`.
  - `make agent-benchmark BENCHMARK_PROVIDER=openai_realtime BENCHMARK_SCENARIO=normal BENCHMARK_ITERATIONS=1 BENCHMARK_RUN_ID=openai-livekit-smoke-31-final BENCHMARK_PERSIST_REALTIME=1`
  - Completed session `is_3f564157e1d071436a5b2411` with 31 events, 3 completed questions, and `event_persistence_complete=true`.
  - Transcript reconstruction returned 3 candidate turns.
  - Persisted provider metadata included `openai_realtime.smoke_status=connected`, `handshake_event_type=session.created`, and an OpenAI session id.
  - Secret-like `sk-` values were not present in persisted provider metadata.
