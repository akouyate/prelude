# Ship State

## Objective

Ship GitHub issue #111: recruiter candidate invitation workflow.

## Scope

- Let an authenticated recruiter create a candidate invitation for a published
  role/interview from the role detail view.
- Support candidate name, optional email, default/custom expiry, generated
  `ci_...` link, manual copy-link delivery, and a clear invitation status list.
- Reissue expired or failed invitations by creating a new invitation while
  keeping the old invitation auditable.
- Keep completed invitations immutable and organization-scoped.
- Prepare the server boundary for future email delivery without coupling this
  slice to Resend.

## Phases

- [x] Intake
- [x] Repository investigation
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

- `rtk ./node_modules/.bin/vitest run apps/console/src/server/interviews/candidate-invitations.test.ts`
  - 11 tests passed.
- `rtk ./node_modules/.bin/vitest run apps/console/src/server/interviews/candidate-invitations.test.ts apps/console/src/server/interviews/interview-drafts.publish.test.ts apps/console/src/server/interviews/candidate-review-workflow.test.ts apps/console/src/server/interviews/live-session-insights.test.ts apps/console/src/server/interviews/live-session-evidence.test.ts`
  - 46 tests passed.
- `rtk ./node_modules/.bin/tsc --noEmit -p apps/console/tsconfig.json`
  - Passed.
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json`
  - Passed.
- `rtk git diff --check`
  - Passed.
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5440/prelude?schema=public' node node_modules/.pnpm/prisma@6.19.3_typescript@6.0.3/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma`
  - No pending migrations.
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5440/prelude?schema=public' node scripts/e2e-smoke.mjs --strict --reset --run-id codex-111-invite --console-url http://localhost:3000`
  - Decision Pass.
- Playwright smoke for role invitations:
  - `/roles/interview_e2e_codex-111-invite` exposes a `ci_...` candidate link, Invitations tab, create form, and created test invite.
- Playwright smoke for settings underline tabs:
  - `/settings` renders one underline tablist, defaults to profile, and updates to `/settings?view=workspace`.

## Notes

- User requested underline tab navigation for contextual views; invitations
  should live as a role-detail tab.
- Settings now use the shared underline tab nav with `nuqs` query-state routing.
