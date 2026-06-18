# Ship State

## Objective

Ship issue #18: add the local Docker Postgres environment and Makefile foundation for the realtime event and transcript store.

## Source

- Epic: https://github.com/akouyate/prelude/issues/11
- Architecture RFC ticket: https://github.com/akouyate/prelude/issues/12
- Go Realtime API ticket: https://github.com/akouyate/prelude/issues/14
- Python LiveKit Agent POC ticket: https://github.com/akouyate/prelude/issues/15
- Candidate LiveKit room ticket: https://github.com/akouyate/prelude/issues/13
- Interviewer state machine ticket: https://github.com/akouyate/prelude/issues/16
- Realtime event and transcript store ticket: https://github.com/akouyate/prelude/issues/18

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

- Orchestrator: main Codex thread, owns integration and final validation.
- Ops/DevOps lane: Docker Compose, Postgres defaults, Makefile ergonomics, and local validation.

## Architecture Decision

- Keep this pass scoped to local infrastructure for #18, not the durable event schema.
- Use Docker Compose for local Postgres only; do not introduce production containerization yet.
- Keep the Makefile as thin wrappers around Docker Compose, pnpm, and Prisma.
- Keep `.env.example`, Compose defaults, and Makefile `DATABASE_URL` aligned.
- Prefer boring, explicit defaults: Postgres 16 Alpine image, named local volume, and `pg_isready` healthcheck.

## Notes

- Current branch: `codex/ds18-local-postgres-env`.
- Refinement posted on #18: https://github.com/akouyate/prelude/issues/18#issuecomment-4738682566
- Added root `docker-compose.yml` with local Postgres.
- Added root `Makefile` for local infra and Prisma helpers.
- Updated `README.md` with Docker/Postgres setup commands.
- Ops/DevOps review integrated: no fixed container name, configurable `POSTGRES_PORT`, and `make env-up` waits for Postgres health.
- Made `make db-migrate` non-interactive through `MIGRATION_NAME`, so the initial local migration flow does not hang.
- Made the Postgres Docker volume name explicit and stable: `prelude_postgres_data`.
- Generated and validated the initial Prisma migration for the existing schema.
- Validation passed: `make help`, `docker compose config`, `make env-up POSTGRES_PORT=15432`, psql connectivity, `make db-migrate POSTGRES_PORT=15432`, `make db-generate POSTGRES_PORT=15432`, `pnpm --dir packages/db test`, `pnpm --dir packages/db typecheck`, `pnpm --dir packages/db lint`, `pnpm exec turbo run typecheck`, `pnpm lint`, `pnpm test`, `git diff --check`, and `make env-reset`.
- Port 5432 and 5433 were already allocated on this machine during validation; `POSTGRES_PORT=15432` confirmed the override works.
- Docker cleanup completed: no running Prelude Compose services and no remaining Prelude Docker volume.
