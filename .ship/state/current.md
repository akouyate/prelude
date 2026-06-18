# Ship State

## Objective

Ship issue #41: implement deterministic full-interview orchestration V1 for the
live IA interviewer.

## Source

- Current ticket: https://github.com/akouyate/prelude/issues/41
- Parent epic: https://github.com/akouyate/prelude/issues/11
- Depends on: #16, #18, #39
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
- [x] Delivery

## Team

- Orchestrator: main Codex thread, owns implementation, tests, review, and PR.
- Specialist review: reuse the existing #41 issue refinement from product,
  data/evals, and runtime architecture agents; request fresh agent review only if
  implementation tradeoffs become non-local.

## Architecture Direction

- Keep Go realtime as the append-only event/control plane.
- Add `answer_evaluated` to shared event contracts and Go/Python domains as the
  semantic audit event between candidate transcript and bounded action.
- Move question progression policy into a deterministic Python
  `InterviewOrchestrator` that returns commands instead of calling providers.
- Keep the LLM/provider constrained to speech generation, transcription, and
  future constrained answer-classification support.
- Preserve Go as event validator/store only: envelope, idempotency, supported
  event types, `answer_evaluated` payload shape, and secret-key rejection.
- Wire both the mock runner and OpenAI LiveKit worker through orchestration
  paths so normal 3-question flows can reach `session_completed`.

## Validation

- `uv run --with-requirements requirements.txt python -m compileall app` in
  `services/interviewer-agent`: passed.
- `uv run --with-requirements requirements.txt python -m pytest -q` in
  `services/interviewer-agent`: 67 passed, pytest-asyncio deprecation warnings.
- `go test ./...` in `services/realtime`: 26 passed in 6 packages.
- `pnpm test` in `packages/contracts`: 13 passed.
- `pnpm typecheck` in `packages/contracts`: passed.
