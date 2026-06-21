# Ship State

## Objective

Ship GitHub issue #63: Recruiter Review, internal notes, and review status.

## Scope

- Add a minimal human-owned review workflow on top of real candidate sessions.
- Keep AI recommendation and human review status explicitly separate.
- Preserve V1 statuses: `To review`, `To call`, and `Archived`.
- Let owner/admin/recruiter update status and internal note from candidate
  detail.
- Keep viewer access read-only with server-side mutation rejection.
- Persist latest status/note author and timestamp.
- Add a lightweight review event log for status and note changes.
- Reflect current status and note preview in dashboard and interview candidate
  lists.
- Avoid copy that implies automatic hiring, rejection, or ranking decisions.

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
- [x] Delivery

## Validation

- HR/recruiter business validation completed by agent Avicenna.
- `pnpm --dir apps/console test`: passed, 8 files / 46 tests.
- `pnpm --dir apps/console typecheck`: passed.
- `pnpm --dir apps/console lint`: passed.
- `pnpm --dir packages/db typecheck`: passed.
- `DATABASE_URL='postgresql://postgres:postgres@localhost:15432/prelude?schema=public' pnpm --dir packages/db exec prisma validate --schema prisma/schema.prisma`: passed.
- `DATABASE_URL='postgresql://postgres:postgres@localhost:15432/prelude?schema=public' pnpm --dir packages/db db:migrate`: applied `20260621132000_candidate_review_notes_status`.
- `make e2e-smoke POSTGRES_PORT=15432 REDIS_PORT=16379 DATABASE_URL='postgresql://postgres:postgres@localhost:15432/prelude?schema=public' E2E_SMOKE_RUN_ID=review-63-smoke E2E_SMOKE_CONSOLE_URL=http://localhost:3000`: passed.
- Playwright browser smoke: updated `cs_e2e_review-63-smoke` to `To call`, saved an internal note, verified candidate detail and dashboard reflection.
- `git diff --check`: passed.

## Remaining Follow-Up

- Team comment threads, notifications, ATS kanban, automated AI status changes,
  candidate-facing outcomes, and multi-reviewer approvals remain out of scope
  for this V1 slice.
