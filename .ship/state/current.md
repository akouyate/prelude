# Ship State

## Objective

Ship GitHub issue #110: finalize V1 candidate lifecycle and business rules.

## Scope

- Represent the candidate lifecycle in code with explicit product statuses,
  allowed transitions, consent gates, retry/resume policy, and terminal states.
- Use the lifecycle in the candidate start/complete endpoints instead of raw
  string status checks.
- Keep V1 audio-first with form fallback; do not surface video as a V1 mode.
- Prevent misleading recruiter analysis: full candidate briefs only for
  completed sessions, with partial/failed/insufficient cases clearly labelled.
- Preserve human-review-only, protected-trait exclusion, and idempotent
  completion behavior.

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
- [x] Delivery

## Validation

- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5432/prelude?schema=public' node node_modules/.pnpm/prisma@6.19.3_typescript@6.0.3/node_modules/prisma/build/index.js validate --schema packages/db/prisma/schema.prisma`
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5432/prelude?schema=public' node node_modules/.pnpm/prisma@6.19.3_typescript@6.0.3/node_modules/prisma/build/index.js generate --schema packages/db/prisma/schema.prisma`
- `rtk ./node_modules/.bin/vitest run packages/core/src/domain/candidate-lifecycle.test.ts packages/contracts/src/schemas/brief.test.ts apps/candidate/app/api/live-interview-sessions/route.test.ts 'apps/candidate/app/api/candidate-sessions/[sessionId]/complete/route.test.ts' 'apps/candidate/app/api/candidate-sessions/[sessionId]/lifecycle/route.test.ts' apps/candidate/src/features/live-interview/live-interview-client.test.ts apps/candidate/src/features/live-interview/live-interview-runtime.test.ts apps/console/src/server/interviews/interview-drafts.publish.test.ts apps/console/src/server/interviews/candidate-brief-generation.test.ts apps/console/src/server/interviews/live-session-evidence.test.ts apps/console/src/server/interviews/live-session-insights.test.ts`
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json`
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/contracts/tsconfig.json`
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/types/tsconfig.json`
- `rtk ./node_modules/.bin/tsc --noEmit -p apps/candidate/tsconfig.json`
- `rtk ./node_modules/.bin/tsc --noEmit -p apps/console/tsconfig.json`
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5440/prelude?schema=public' node node_modules/.pnpm/prisma@6.19.3_typescript@6.0.3/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma`
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5440/prelude?schema=public' node scripts/e2e-smoke.mjs --strict --reset --run-id codex-110-invite --console-url http://localhost:3000`
- `rtk ./node_modules/.bin/playwright test -c apps/candidate/playwright.config.ts`
  - mobile audio primary smoke
  - microphone-denied written fallback smoke
- `rtk ./node_modules/.bin/prettier --check apps/candidate/src/server/public-interviews.ts apps/candidate/app/api/form-interview-sessions/route.ts apps/candidate/src/features/live-interview/live-interview-client.ts apps/candidate/src/features/live-interview/live-interview-room.tsx apps/candidate/e2e/interview.spec.ts apps/candidate/playwright.config.ts docs/architecture/v1-domain-spine.md .ship/state/current.md scripts/e2e-smoke.mjs`
- `rtk git diff --check`

## Remaining Follow-Up

- Named invite creation UI and notification delivery are follow-up workflow
  tickets, not blockers for the core lifecycle/business-rules slice.
