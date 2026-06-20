# Ship State

## Objective

Ship GitHub issue #56: persist organization onboarding as resumable product
state.

## Scope

- Persist organization onboarding progress before final completion.
- Hydrate the onboarding wizard from persisted progress after refresh.
- Keep `onboardingCompletedAt` reserved for the final valid submit.
- Store LinkedIn/Indeed/manual source choice as onboarding preference while
  keeping connectors mocked.
- Persist organization preferences so the dashboard can read and display them.
- Use existing repo patterns and libraries: Next server actions, Prisma, Clerk,
  and Zod contracts.

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

- Do not introduce a new policy/RBAC library in #56; #55 owns organization
  ownership and permissions. Zod is enough for onboarding state validation here.
- Store resumable wizard state as versionable JSON on `Organization`, with a
  separate `onboardingStep` for the current wizard position.
- Use upserts for idempotent progress saves and completion.
- Keep completion redirect on the dashboard per #56 acceptance criteria.

## Validation

- `DATABASE_URL=postgresql://user:pass@localhost:5432/prelude pnpm --dir packages/db exec prisma validate --schema prisma/schema.prisma`: passed.
- Temporary Postgres database `prelude_ship56` with `prisma migrate deploy`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm --dir packages/contracts run test`: 3 files, 19 tests passed.
- `pnpm --dir apps/console run test`: no test files found, pass with no tests.
- `pnpm --dir apps/console run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- #55 still owns canonical Clerk organization ownership and the full permission
  matrix.
- #57 owns turning the persisted first job into a publishable live interview
  plan.
