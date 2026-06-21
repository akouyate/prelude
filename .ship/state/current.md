# Ship State

## Objective

Ship GitHub issue #86: Harden real candidate room lifecycle and realtime UX.

## Scope

- Keep the Redis auto-worker path as the normal real live interviewer launch.
- Add candidate runtime state visibility for joining, joined, speaking,
  listening, reconnecting, closing, completed, and failed states.
- Keep LiveKit transcript packets/streams primary with HTTP transcript polling
  as fallback.
- Prevent silent completion by surfacing a closing/checkout state before the
  final completion panel.
- Strengthen live smoke reporting for lifecycle anomalies and closing evidence.
- Preserve the simple full-height candidate room UX.

## Phases

- [x] Intake
- [x] Repository investigation
- [x] Issue refinement
- [x] Skill loading
- [x] Architecture review
- [x] Plan
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [ ] Delivery

## Validation

- `pnpm --dir apps/candidate test`: passed, 6 files / 31 tests.
- `pnpm --dir apps/candidate typecheck`: passed.
- `pnpm --dir apps/candidate lint`: passed.
- `env E2E_DATABASE_URL='postgresql://postgres:postgres@localhost:15432/prelude?schema=public' pnpm --dir apps/candidate test:e2e`: passed, 2 mobile Chromium tests.
- `make e2e-smoke POSTGRES_PORT=15432 REDIS_PORT=16379 DATABASE_URL='postgresql://postgres:postgres@localhost:15432/prelude?schema=public' E2E_SMOKE_RUN_ID=live-86-smoke E2E_SMOKE_CONSOLE_URL=http://localhost:3000`: passed.
- `go test ./...` from `services/realtime`: passed, 45 tests / 7 packages.
- `.venv/bin/python -m pytest tests/test_auto_worker.py tests/test_live_worker.py tests/test_business_rules.py` from `services/interviewer-agent`: passed, 15 tests.
- `node --check scripts/live-smoke-report.mjs`: passed.
- `make help`: passed and lists `live-smoke-report-strict`.
- `pnpm run typecheck`: passed, 15 turbo tasks.
- `pnpm lint`: passed, 15 turbo tasks.
- `pnpm test`: passed, 15 turbo tasks.
- `git diff --check`: passed.
- `node scripts/live-smoke-report.mjs --strict` against a synthetic realtime
  replay: passed, including `session_closing` before `session_completed` and a
  closing interviewer transcript turn.

## Not Run

- A paid real OpenAI/LiveKit mobile tunnel session was not run in this pass.
  Required credentials are present, but no interactive candidate session was
  available to complete a real mobile interview during implementation. The
  strict smoke command is now available for that live run.

## Remaining Follow-Up

- #87 answer quality/business evaluation rules, recruiter dashboard analytics,
  and replacing Redis/LiveKit architecture remain out of scope for this V1
  slice.
