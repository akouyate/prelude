# Ship State

## Objective

Ship GitHub issue #54: define and implement the canonical V1 domain spine that
connects organization, users, jobs, interview plans, candidate sessions, live
runtime evidence, candidate briefs, and recruiter review with persisted data.

## Scope

- Audit the current Prisma schema and server loaders against the target spine:
  `Organization -> User/Membership -> Job -> InterviewDraft -> Interview ->
  CandidateSession -> LiveInterviewSession/Event -> CandidateBrief ->
  RecruiterReview`.
- Add or normalize missing database relationships that make the spine explicit.
- Add status enums or centralized validation where practical for the V1 spine.
- Add org-scoped helper/query surface for candidate-session review data.
- Document the canonical model, runtime link decisions, deferred items, and
  product constraints.

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

- Keep `CandidateSession` as the durable recruiter/candidate product aggregate.
- Keep `LiveInterviewSession` as runtime evidence linked through the external
  `realtimeSessionId`; do not reintroduce a cross-service DB foreign key.
- Make `CandidateBrief` persisted and versionable, but do not build LLM
  generation in this ticket.
- Preserve existing demo/dev fallbacks only where they are clearly isolated from
  production product routes.

## Validation

- `DATABASE_URL=postgresql://user:pass@localhost:5432/prelude pnpm --dir packages/db exec prisma validate --schema prisma/schema.prisma`: passed.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/prelude pnpm --dir packages/db run db:generate`: passed.
- Temporary Postgres database `prelude_ship54` with `prisma migrate deploy`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm --dir packages/contracts run test`: 2 files, 17 tests passed.
- `pnpm --dir packages/core run test`: 1 file, 2 tests passed.
- `pnpm --dir apps/candidate run test`: 2 files, 8 tests passed.
- `pnpm --dir apps/console run test`: no test files found, pass with no tests.
- `pnpm --dir apps/console run build`: passed.
- `pnpm --dir apps/candidate run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- #58 owns replacing candidate demo-token fallbacks with real published links.
- #60 owns generating `CandidateBrief` after live completion.
- #61 owns consuming the persisted brief and transcript in the full recruiter
  review UX.
