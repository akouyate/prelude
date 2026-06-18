# Ship State

## Objective

Ship issue #17: implement turn-taking and interruption guardrails for the live IA interviewer POC.

## Source

- Epic: https://github.com/akouyate/prelude/issues/11
- Architecture RFC ticket: https://github.com/akouyate/prelude/issues/12
- Go Realtime API ticket: https://github.com/akouyate/prelude/issues/14
- Python LiveKit Agent POC ticket: https://github.com/akouyate/prelude/issues/15
- Candidate LiveKit room ticket: https://github.com/akouyate/prelude/issues/13
- Interviewer state machine ticket: https://github.com/akouyate/prelude/issues/16
- Turn-taking and interruption guardrails ticket: https://github.com/akouyate/prelude/issues/17

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
- [x] Delivery

## Team

- Orchestrator: main Codex thread, owns integration and final validation.
- Architecture lane: docs and shared contracts.
- Go lane: `services/realtime/**` event acceptance.
- Python lane: `services/interviewer-agent/**` turn-taking policy and mocked behavior.

## Architecture Decision

- Keep Go as the product/event control plane.
- Keep Python as the IA interviewer policy/runtime boundary.
- Keep LiveKit/OpenAI/ElevenLabs decisions provider-switchable until #19.
- Implement #17 as a provider-neutral policy layer that consumes normalized turn signals.
- Do not model turn-taking as raw silence timeout only; use VAD/semantic/acoustic/provider signals where available, with configurable POC defaults.
- Use TDD for policy rules: normal turn, true barge-in, false barge-in/backchannel, wait request, repeat, silence recovery, and no agent speech while candidate speaks.

## Notes

- Current branch: `codex/turn-taking-guardrails`.
- LiveKit Adaptive Interruption Handling confirms VAD-only false barge-ins are a known product problem.
- OpenAI Realtime exposes VAD turn events plus interruption/truncation semantics.
- ElevenLabs exposes silence, interruptions, and turn eagerness controls.
- #17 refinement is already posted on GitHub in issue comments; implementation should align with that refinement.
- Added provider-neutral Python `TurnTakingPolicy` plus deterministic tests.
- Added runner events for speech start/complete, candidate speech signals, turn detection, silence thresholds, wait request, and mocked accepted barge-in smoke.
- Added Go and TypeScript contract support for the #17 event vocabulary.
- Added dedicated research doc `docs/research/live-ia-interviewer-turn-taking.md`.
- Validation passed: Python compileall/pytest, Go test/vet/race, TypeScript contracts test, monorepo typecheck/lint/test/build, git diff --check.
- Manual smoke passed: Go API on port 18080 plus Python worker `--join-livekit --simulate-barge-in` persisted `barge_in_accepted` and `agent_speech_interrupted`.
- Delivery PR: https://github.com/akouyate/prelude/pull/27
