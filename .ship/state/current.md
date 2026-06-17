# Ship State

## Objective

Ship GitHub issue #13: build the POC LiveKit candidate room on top of the live IA interviewer foundation.

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
- [x] Delivery

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
