# Ship State

## Objective

Ship GitHub cleanup plus issue #15: build the Python LiveKit Agent POC on top of the live IA interviewer foundation.

## Source

- Epic: https://github.com/akouyate/prelude/issues/11
- Architecture RFC ticket: https://github.com/akouyate/prelude/issues/12
- Go Realtime API ticket: https://github.com/akouyate/prelude/issues/14
- Python LiveKit Agent POC ticket: https://github.com/akouyate/prelude/issues/15
- Candidate LiveKit room ticket: https://github.com/akouyate/prelude/issues/13

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

- Orchestrator: main Codex thread, owns integration and final validation.
- Architecture agent: owns docs and shared contracts.
- Go agent: owns `services/realtime/**`.
- Python agent: owns `services/interviewer-agent/**`.

## Architecture Decision

- Keep Next.js for recruiter and candidate UX.
- Add a Go Prelude Realtime API as the product control plane.
- Use LiveKit as the media/WebRTC plane, with mocked boundaries for the POC.
- Add a Python IA interviewer runtime as the first agent worker.
- Use OpenAI Realtime as the primary provider target.
- Keep ElevenLabs as a benchmark/challenger, not the initial orchestration layer.
- Keep Pipecat out of V1 unless LiveKit Agents becomes too constraining.
- Use a TDD approach for business behavior: contracts, session lifecycle, event ingestion, and interviewer state machine should be described by focused tests before implementation is expanded.

## Notes

- Existing UI mock changes are uncommitted and must not be reverted.
- POC should stay KISS but use clean boundaries that can survive commercial iteration.
- Tests should focus on business rules and integration contracts rather than exhaustive framework coverage.
- Validation passed for Go, Python, TypeScript contracts, monorepo typecheck/lint/test/build, and a Go API + Python worker smoke test.
- #13 adds a candidate live room with microphone/camera permission flow, a Next.js API proxy to the Go Realtime API, LiveKit SDK dynamic join support, mock LiveKit fallback, mobile e2e coverage, and a Playwright screenshot at `/tmp/prelude-livekit-candidate-room.png`.
- #12 and #13 were closed on GitHub after verifying they were delivered on `main` by PR #24.
- #14 remains open because agent token/config and event actor attribution were missing; those are now part of the #15 branch scope.
- #15 scope: add a Go agent-config endpoint, mint a distinct agent LiveKit join, require event `actor`, and let the Python runner join a LiveKit room through a mockable adapter before emitting interview events.
- Validation passed for Go tests/vet/race, Python pytest/compileall, contracts tests, monorepo typecheck/lint/test/build, and a local Go API + Python `--join-livekit` smoke test with 21 persisted events and completed session status.
