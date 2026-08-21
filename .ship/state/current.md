# Current ship state

## Goal

Add production-shaped `*.hirecall.localhost` entrypoints that are generated,
isolated, and collision-safe for every Git worktree while preserving the local
marketing-demo handoff and service-auth boundaries.

## Scope

- Generate stable, valid worktree identifiers and deterministic host ports.
- Use distinct landing, console, candidate, and realtime `.localhost` hosts.
- Isolate Docker Compose project/container/network/volume ownership per worktree.
- Keep exact marketing-demo return targets aligned across Docker and Next.js.
- Add generic `make` lifecycle and URL discovery commands.
- Validate collisions, ownership, secrets, origins, and live endpoint routing.

## Workflow

- [x] Audit the existing Prelude and Fluenceur worktree patterns
- [x] Finalize the domain, port, and Compose isolation design
- [x] Implement generated worktree configuration and lifecycle commands
- [x] Start and exercise the marketing-demo stack through the new hosts
- [x] Review, simplify, and run final validation

## Decisions

- `.localhost` requires no host-file or DNS mutation and remains the canonical
  local suffix.
- Every worktree needs a distinct hostname namespace because cookies ignore
  ports; port isolation alone is insufficient.
- Runtime addresses are generated in the gitignored `.env.worktree`; committed
  production defaults remain unchanged.
- The website-to-candidate bearer remains server-only regardless of hostname.
- Dotenvx worktree overrides load before the shared encrypted environment,
  matching its first-value-wins behavior.
- Cleanup restores a pre-init `.env.worktree` only when the generated file still
  matches its ownership checksum; Docker data is never removed implicitly.

## Validation target

- Two registered worktrees cannot receive colliding ports, Compose projects, or
  cookie hostnames.
- `make init`, `make doctor`, `make urls`, and cleanup are idempotent and generic.
- Candidate emits preview URLs on its generated candidate hostname.
- Exact landing return-target admission works and near-match targets fail.
- Existing tests, lint, typechecks, Docker health checks, and secret hygiene pass.

## Result

Complete locally. Worktree `8d2d` runs as Compose project `prelude-8d2d` with
Console `30500`, Candidate `30501`, landing reservation `30502`, realtime
`30503`, Postgres `30504`, and Redis `30505`. Doctor, worktree isolation tests,
Compose health checks, authenticated role discovery, and real demo admission
all pass through the generated `.localhost` hosts. The external landing process
can load `.worktree/marketing-landing.env`; no secret was printed or placed in a
public variable.
