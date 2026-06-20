# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current implementation slice:
GitHub issue #20, compliance and candidate trust guardrails.

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
- Added an explicit local-only Clerk mock provider for development/test when
  Clerk keys are empty.
- Routed onboarding, organization-scope resolution, and console auth context
  through the shared auth provider.
- Added policy coverage for authenticated, unauthenticated, not-onboarded,
  wrong-organization, and inactive-membership access cases.
- Added a tested publication-mode policy for interview drafts.
- Hardened publish behavior so edits after publication create a new immutable
  interview snapshot instead of mutating the previous candidate link snapshot.
- Closed #55 and #57 after merge evidence and smoke validation.
- Added `docs/operations/live-ia-commercial-poc-checklist.md` with go/no-go
  criteria, demo script, evidence capture, risks, and non-goals.
- Closed #23 after linking the checklist from #11.
- Added canonical compliance copy, disallowed topics, human-in-the-loop rule,
  and compliance flags in `@prelude/core`.
- Added `complianceFlags` to CandidateBrief and live recruiter summary
  contracts.
- Added compliance flags to Go realtime recruiter summaries and local
  CandidateBrief generation.
- Added `docs/operations/compliance-trust-guardrails.md`.
- Hardened console auth strategy with `CONSOLE_AUTH_PROVIDER=auto|clerk|mock`.
- Added `@clerk/testing` Playwright setup for real Clerk E2E while keeping
  product smoke tests on the local mock provider by default.

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
- Core workflow P0 implementation slices are closed through #57.
- #20 should close when the compliance/trust guardrail slice merges.
- #21 remains the final recruiter-insights wrapper epic.

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
- `pnpm --dir apps/console test`: passed.
- `pnpm --dir apps/console test -- interview-plan-policy`: passed.
- `make e2e-smoke E2E_SMOKE_RUN_ID=codex57-publish POSTGRES_PORT=55432 DATABASE_URL=...`:
  passed with decision `Pass`.
- `pnpm exec prettier --check README.md docs/architecture/v1-e2e-release-workflow.md docs/operations/live-ia-commercial-poc-checklist.md .ship/state/current.md`:
  passed for #23.
- `pnpm --dir apps/console test`: passed.
- `pnpm --dir apps/console typecheck`: passed.
- `pnpm --dir apps/console lint`: passed.
- `pnpm --dir apps/console test:e2e`: passed on isolated Playwright server.
- `pnpm --dir packages/core test`: passed.
- `pnpm --dir packages/core typecheck`: passed.
- `pnpm --dir packages/core lint`: passed.
- `pnpm --dir packages/contracts test`: passed.
- `pnpm --dir packages/contracts typecheck`: passed.
- `pnpm --dir packages/contracts lint`: passed.
- `go test ./...` in `services/realtime`: passed.
- `pnpm exec prettier --check ...`: passed for changed TS/MD files.
- `git diff --check`: passed.

## Remaining Follow-Up

- #20 remains open until this slice is merged.
- #21 remains open as the recruiter interview insights dashboard wrapper.
- #63 owns human notes and review status mutation controls.
