# Ship State

## Objective

Ship GitHub issue #102: complete DB-backed V1 settings forms.

## Scope

- Keep `/settings?view=profile` as the default `nuqs`-controlled settings view.
- Ensure every visible settings control is functional, delegated, disabled with
  honest copy, or represented as integration status only.
- Preserve authenticated organization scoping through the existing settings data
  loader and Server Actions.
- Persist workspace basics, interview preferences, notification preferences, and
  user language in Postgres.
- Keep team and billing actions permission-aware and non-fake.
- Prepare third-party integrations as status records only; no OAuth secrets.

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

- `rtk ./node_modules/.bin/vitest run apps/console/src/server/settings/workspace-settings-data.test.ts`
  passed.
- `rtk ./node_modules/.bin/tsc --noEmit -p apps/console/tsconfig.json`
  passed.
- `rtk ./node_modules/.bin/prettier --check ...` passed for changed
  settings, locale, i18n, test, and ship-state files.
- `rtk git diff --check` passed.
- Browser smoke passed on `http://localhost:3000/settings` with mock auth and
  Postgres: default profile view, workspace persistence, disabled workspace
  logo, notification persistence, Gmail/Microsoft integration cards, and
  disabled Clerk Billing entry.

## Notes

- Existing implementation already has `nuqs` settings tabs, scoped settings
  loader, workspace/interview/notification Server Actions, persisted language
  select, and team invite/member actions.
- Completed fixes:
  - Profile photo controls are now delegated/disabled with provider-aware copy.
  - Workspace logo upload is disabled with honest V1 copy.
  - Billing plan management is represented as a disabled Clerk Billing entry.
  - Integrations include Gmail and Microsoft Teams status cards alongside
    existing job-source, calendar, and ATS entries.
  - Settings text fields remount on refreshed server values to avoid stale Base
    UI default-value warnings after server-action saves.
