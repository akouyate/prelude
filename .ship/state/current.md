# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current implementation slice:
GitHub issue #62, repeatable real-data E2E smoke and demo script.

## Scope

- Added `scripts/e2e-smoke.mjs`, a DB-backed V1 smoke that creates an onboarded
  organization, recruiter membership, job, published interview, candidate
  session, runtime session/events, transcript evidence, and persisted
  `CandidateBrief`.
- Added `make e2e-smoke`, which starts local Postgres and runs the smoke with
  mocked LLM output by default.
- Added `make e2e-smoke-live`, which is gated by `ALLOW_LIVE_LLM_TESTS=1`.
- The smoke prints run id, organization/job/interview ids, candidate session id,
  realtime session id, event count, transcript turn count, brief status, and
  dashboard/detail/candidate URLs.
- Smoke data is repeatable and resettable by run id without resetting the whole
  local database.
- README now documents the V1 E2E smoke command and live-mode guard.

## Phases

- [x] Intake
- [x] Skill loading
- [x] Repository investigation
- [x] Architecture review
- [x] Plan
- [x] Team decision
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [ ] Delivery

## Direction

- #62 gives the team a repeatable local proof of the V1 workflow after #60/#61.
- Default smoke avoids paid LLM calls.
- Live LLM mode remains opt-in and blocked without explicit acknowledgement.
- Continue to final refactor/polish audit after #62 merge.

## Validation

- `node --check scripts/e2e-smoke.mjs`: passed.
- `node scripts/e2e-smoke.mjs --help`: passed.
- `make help`: passed and lists `e2e-smoke` / `e2e-smoke-live`.
- `make e2e-smoke E2E_SMOKE_RUN_ID=codex62 POSTGRES_PORT=55432 DATABASE_URL=...`: passed with decision `Pass`.
- `make e2e-smoke-live ...` without `ALLOW_LIVE_LLM_TESTS=1`: blocked as expected.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm run test`: passed.
- `pnpm --dir apps/console run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- Final refactor/polish audit should inspect the E2E slices together and remove
  any avoidable duplication or rough UI copy before marking the goal complete.
- #63 owns human notes and review status mutation controls.
