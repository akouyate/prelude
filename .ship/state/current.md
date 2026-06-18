# Ship State

## Objective

Ship issue #19: provider benchmark foundation for the live IA interviewer.

## Source

- Epic: https://github.com/akouyate/prelude/issues/11
- Provider benchmark ticket: https://github.com/akouyate/prelude/issues/19
- Architecture: docs/architecture/live-ia-interviewer.md
- Turn-taking research: docs/research/live-ia-interviewer-turn-taking.md

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
- Existing agents:
  - Architecture challenge: Go/Python/LiveKit boundaries and coupling risk.
  - IA/provider challenge: OpenAI Realtime vs ElevenLabs, prompts, interruptions, costs.
  - Data/evals challenge: metrics, repeatability, report quality.
  - Implementation challenge: Python/Go interfaces, CLI, env handling, tests.

## Architecture Decision

- Keep #19 scoped to a repeatable benchmark harness and provider-selection evidence.
- Reuse the existing Python `ProviderAdapter` and `InterviewSessionRunner`.
- Keep LiveKit as the media/WebRTC plane and Go Realtime API as the event source of truth.
- Do not commit provider secrets or require real OpenAI/ElevenLabs credentials for tests.
- Add credential-gated provider adapters that fail with actionable setup errors when keys/access are missing.
- Add deterministic scenarios so OpenAI and ElevenLabs can be compared with the same plan, candidate behavior, metrics, and metadata.

## Notes

- Current branch: `codex/ship-19-provider-benchmark`.
- Implementation plan:
  1. Add benchmark scenarios, runner, report models, and CLI.
  2. Enrich emitted events with `benchmark_run_id`, scenario, iteration, provider, and provider metadata.
  3. Add provider adapter factory with mock, OpenAI Realtime placeholder, and ElevenLabs placeholder.
  4. Document required provider accounts/env and benchmark commands.
  5. Add an initial research/report template for comparing providers.
  6. Validate Python tests and smoke the CLI locally.
- Added `make agent-benchmark` for root-level local benchmark runs.
- Validation passed:
  - `uv run --with-requirements requirements.txt python -m compileall app`
  - `uv run --with-requirements requirements.txt python -m pytest -q`
  - `python -m app.benchmark_cli --provider mock_openai_realtime --scenario repeat --iterations 2 ...`
  - `python -m app.benchmark_cli --provider openai_realtime --scenario normal --iterations 1 ...` with empty env, returning a structured `blocked` report.
  - `make agent-benchmark BENCHMARK_PROVIDER=mock_openai_realtime BENCHMARK_SCENARIO=normal BENCHMARK_ITERATIONS=1 BENCHMARK_RUN_ID=make-smoke`
  - `make help`
  - `git diff --check`
