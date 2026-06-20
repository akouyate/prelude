# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current implementation slice:
GitHub issue #58, candidate public interview flow.

## Scope

- Public candidate tokens now resolve only to published `Interview` records.
- Unknown, unpublished, blank, or unavailable links render a clear unavailable
  state instead of silently falling back to a demo session.
- Candidate preflight now shows company, role, estimated duration, available
  response modes, AI screening disclosure, optional name/email fields, and
  explicit consent before microphone/camera access.
- Starting or resuming creates/updates a persisted `CandidateSession` linked to
  `Organization`, `Job`, and `Interview`, with consent metadata and a
  `resumeToken`.
- The candidate API sends the product session id to the realtime service as the
  candidate id and marks the product session failed if realtime preparation
  fails.
- Ending the interview shows a clear thank-you state and marks the product
  `CandidateSession` completed when the resume token matches.

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

- #58 completes the candidate public link, consent, identity, allowed modes, and
  controlled product-session start/resume path.
- Keep automated tests LLM/realtime-cost safe: Prisma and realtime are mocked in
  unit/API tests; Playwright uses a DB seed plus mocked realtime/session events.
- Continue to later slices only after each slice has validation evidence.

## Validation

- `pnpm --dir apps/candidate run test`: passed, 3 files / 12 tests.
- `pnpm --dir apps/candidate run typecheck`: passed.
- `pnpm --dir apps/candidate run lint`: passed.
- `pnpm --dir apps/candidate run test:e2e`: passed, 2 mobile Chromium tests.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/prelude pnpm --dir packages/db exec prisma validate --schema prisma/schema.prisma`: passed.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/prelude_ship58?schema=public pnpm --filter @prelude/db exec prisma migrate deploy --schema prisma/schema.prisma`: passed on a fresh temporary DB.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/prelude?schema=public pnpm --filter @prelude/db exec prisma migrate deploy --schema prisma/schema.prisma`: passed for local E2E DB.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm run test`: passed.
- `pnpm --dir apps/candidate run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- #59 still owns completion/thank-you persistence and candidate lifecycle
  transitions after the live session ends.
- #60 still owns persisted `CandidateBrief`; recruiter detail still uses
  existing summary paths until that slice lands.
- #61/#62 still own dashboard/workflow polish and final E2E hardening.
