# Ship State

## Objective

Ship issue #37: prepare the live room E2E polish for the OpenAI/LiveKit test.

## Source

- Current ticket: https://github.com/akouyate/prelude/issues/37
- Parent epic: https://github.com/akouyate/prelude/issues/11
- Depends on: #16, #18, #19, #39, #41
- Unblocks: #21, #22, #23

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

- Orchestrator: main Codex thread, owns implementation, tests, review, and PR.
- Specialist review: reuse the existing live-interviewer architecture and eval
  refinement; request fresh agent review only if implementation tradeoffs become
  non-local.

## Architecture Direction

- Keep Go realtime as the append-only event/control plane.
- Split candidate readiness into two durable events:
  `candidate_joined` for room entry and `candidate_media_ready` after local media
  publication.
- Keep the candidate frontend responsible for publishing local tracks and
  emitting readiness events; do not let the worker infer readiness from page
  state.
- Make the OpenAI/LiveKit worker wait for both candidate readiness events before
  joining the room and starting the first IA turn.
- Preserve a KISS POC scope: better mobile-safe start behavior, observable
  readiness, and smoke reporting rather than a new dashboard view.

## Validation

- `pnpm test` in `apps/candidate`: 2 files, 8 tests passed.
- `pnpm lint` in `apps/candidate`: passed.
- `pnpm typecheck` in `apps/candidate`: passed.
- `pnpm test` in `packages/contracts`: 2 files, 15 tests passed.
- `pnpm typecheck` in `packages/contracts`: passed.
- `go test ./...` in `services/realtime`: 36 passed in 6 packages.
- `uv run --with-requirements requirements.txt python -m pytest -q` in
  `services/interviewer-agent`: 70 passed, pytest-asyncio deprecation warnings.
- `git diff --check`: passed.
