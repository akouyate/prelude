# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current delivery polish slice:
document the dynamic E2E release workflow and audit remaining P0 scope.

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
- Added `docs/architecture/v1-e2e-release-workflow.md` to make the orchestrator
  and feature-team release loop explicit.
- Audited remaining open P0 scope after #60, #61, and #62 merged.
- Extracted and tested the shared Clerk-to-Prelude organization role mapping
  used by onboarding and organization-scope resolution.

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
- [x] Delivery

## Direction

- #62 gives the team a repeatable local proof of the V1 workflow after #60/#61.
- The release workflow document now makes the remaining open P0 boundaries
  explicit instead of treating issue cleanup as implicit completion.
- Default smoke avoids paid LLM calls.
- Live LLM mode remains opt-in and blocked without explicit acknowledgement.
- Continue remaining P0 work through #55/#57/#37/#23 rather than expanding the
  current smoke slice.

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
- `pnpm --dir apps/console test -- organization-access-policy`: passed.
- `pnpm --dir apps/console typecheck`: passed.
- `pnpm --dir apps/console lint`: passed.

## Remaining Follow-Up

- #55 is still open and needs targeted auth/org-scope tests before it can be
  considered fully proven.
- #57 is still open and owns publish/versioning hardening plus job metadata and
  compliance-copy gating.
- #37 has real OpenAI/LiveKit mobile smoke evidence and merged implementation,
  but remains open pending final product-owner closure.
- #23 remains open as the commercial POC go/no-go wrapper.
- #63 owns human notes and review status mutation controls.
