# Ship State

## Objective

Ship GitHub issue #104: first-party OAuth foundation and connected-account
model.

## Scope

- Add a V1 `ConnectedAccount` model scoped to organization + user.
- Support Google OAuth connect/disconnect from Settings > Integrations for the
  Calendar capability only.
- Persist provider identity, scopes, capabilities, token expiry/refresh
  metadata, external account id/email, status, and error/reconnect state.
- Encrypt token material at rest and keep token values server-only.
- Introduce provider adapter boundaries so Calendar, Gmail, and Microsoft can
  reuse a common connected-account domain later.
- Keep Gmail, Microsoft, LinkedIn, Indeed, URL import, and file upload out of
  this ticket except as visible future integration states.

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
- [x] Delivery

## Validation

- `rtk ./node_modules/.bin/vitest run apps/console/src/server/settings/workspace-settings-data.test.ts apps/console/src/server/integrations/connected-account-crypto.test.ts apps/console/src/server/integrations/connected-account-oauth-state.test.ts apps/console/src/server/integrations/google-connected-account-provider.test.ts apps/console/src/server/integrations/connected-account-types.test.ts apps/console/src/server/integrations/connected-account-service.test.ts`
  passed: 6 files, 14 tests.
- `rtk ./node_modules/.bin/tsc --noEmit -p apps/console/tsconfig.json`
  passed.
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/db/tsconfig.json`
  passed.
- `rtk ../../node_modules/.bin/eslint .` from `apps/console` passed.
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5432/prelude?schema=public' packages/db/node_modules/.bin/prisma validate --schema packages/db/prisma/schema.prisma`
  passed.
- `rtk env DATABASE_URL='postgresql://postgres:postgres@localhost:5440/prelude?schema=public' packages/db/node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma`
  applied `20260707110000_connected_accounts` locally.
- `rtk ./node_modules/.bin/prettier --check ...` passed for parser-supported
  changed TS/TSX/JSON/MD files.
- `rtk git diff --check` passed.
- Playwright smoke on `http://localhost:3000/settings?view=integrations`
  passed with mock auth/Postgres and missing Google OAuth config: Settings
  renders, Google Calendar shows setup required, Connect is disabled, and
  future integration cards render.
- Playwright smoke with fake Google OAuth env passed by intercepting the
  outgoing authorization request: Connect is enabled, the request targets
  Google OAuth, includes `calendar.events`, includes signed `state`, and does
  not request Gmail scopes.
- PR #112 was merged into `main`, closing GitHub issue #104.

## Notes

- `JobSourceConnection` remains the job-source/import status model. It is not
  suitable for Google OAuth token ownership or provider capabilities.
- Official Google guidance for web-server OAuth recommends confidential
  server-side handling, state, offline access, incremental authorization, and
  narrowly scoped permissions. This ticket follows that with direct REST calls
  rather than adding a broad integration platform dependency.
- The disconnect flow always invalidates local token material. It attempts
  provider revocation only when Google OAuth config is available.
