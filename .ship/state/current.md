# Ship State

## Objective

Ship GitHub issue #64: V1 copy and policy guardrails enforcement.

## Scope

- Centralize V1 compliance copy, versions, and guardrails in `@prelude/core`.
- Persist candidate consent with the canonical copy version.
- Display candidate disclosure and recruiter limitation copy consistently.
- Feed disallowed topics and sensitive-information rules into AI synthesis.
- Avoid UI copy that implies automatic hiring, rejection, ranking, or scoring.
- Keep CI/smoke paths mocked by default for paid LLM providers.

## Phases

- [x] Intake
- [x] Repository investigation
- [x] Issue refinement
- [x] HR validation
- [x] Architecture review
- [x] Plan
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [ ] Delivery

## Validation

- `pnpm --dir packages/core test`: passed, 2 files / 6 tests.
- `pnpm --dir apps/console test`: passed, 8 files / 47 tests.
- `pnpm --dir apps/candidate test`: passed, 5 files / 24 tests.
- `pnpm run typecheck`: passed, 15 turbo tasks.
- `pnpm lint`: passed, 15 turbo tasks.
- `pnpm test`: passed, 15 turbo tasks.
- `make e2e-smoke POSTGRES_PORT=15432 REDIS_PORT=16379 DATABASE_URL='postgresql://postgres:postgres@localhost:15432/prelude?schema=public' E2E_SMOKE_RUN_ID=compliance-64-smoke E2E_SMOKE_CONSOLE_URL=http://localhost:3000`: passed.
- `git diff --check`: passed.

## Remaining Follow-Up

- Legal review sign-off, DSAR/data retention flows, enterprise compliance
  controls, and regional policy branching remain out of scope for this V1
  slice.
