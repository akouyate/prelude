# Ship State

## Objective

Ship GitHub issue #10: stabilize Prelude UI foundations and reusable
components.

## Scope

- Consolidate shared console primitives for actions, icon actions, metrics,
  selection cards, radio cards, fields, tabs, panels, badges, and empty states.
- Normalize active/inactive selection states across role builder, onboarding,
  settings, and candidate-detail patterns.
- Keep candidate table/list implementations shared across dashboard, role
  detail, and candidates views.
- Keep the left sidebar shell consistent, fixed, and reusable.
- Document the current design-system component rules.

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

- `rtk ../../node_modules/.bin/vitest run src/components/button.test.tsx src/components/radio-card.test.tsx src/components/metric-card.test.tsx`
  - 3 files / 3 tests passed from `packages/ui`.
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/ui/tsconfig.json`
  - Passed.
- `rtk ./node_modules/.bin/tsc --noEmit -p apps/console/tsconfig.json`
  - Passed.
- `rtk ./node_modules/.bin/tsc --noEmit -p packages/design-system/tsconfig.json`
  - Passed.
- `rtk git diff --check`
  - Passed.
- `rtk ./node_modules/.bin/prettier --check ...changed UI files...`
  - Passed after formatting five changed files.
- Playwright smoke against `http://localhost:3000` with mock auth:
  - `/`, `/roles`, `/roles/new`, `/settings`, `/candidates` returned 200 with no runtime error text.
  - Discovered candidate detail `/interviews/is_e2e_codex-111-invite` returned 200 with no runtime error text.
  - `/roles/new` desktop/mobile screenshots written to `/tmp/prelude-issue10-roles-new-desktop.png` and `/tmp/prelude-issue10-roles-new-mobile.png`.
  - `/roles/new` Calibrate screenshot written to `/tmp/prelude-issue10-calibrate-desktop.png`.
  - Candidate detail screenshot written to `/tmp/prelude-issue10-candidate-detail-desktop.png`.

## Notes

- Existing tracked work before this pass already added `Surface`, `Field`,
  `TextField`, `SelectField`, `UnderlineTabs`, `SegmentedTabs`, shared candidate
  screen table usage, and settings `nuqs` routing.
- This pass adds the missing icon-button, metric, selection-card, and radio-card
  pieces, then migrates the duplicated feature surfaces that block #10.
