# Current ship state

## Goal

Rebrand the visible product from Prelude to HireCall, prepare the next
first-party integration capabilities, and ship a chaptered interview replay
that lets recruiters play a complete recording or one question segment.

## Scope

- Replace user-visible Prelude and Prelude.ai branding with HireCall across the
  recruiter app, candidate app, email copy, metadata and product documentation.
- Keep internal package names, database identifiers and historical migrations
  stable to avoid a risky namespace migration.
- Use the supplied HireCall wordmark and favicons throughout both web apps.
- Replace placeholder integration marks with sourced brand SVGs.
- Preserve the working Google Calendar OAuth capability and document the
  capability boundaries for Gmail, LinkedIn and Indeed.
- Derive replay chapters from persisted question/transcript timestamps.
- Let question and key-moment actions seek the shared player, with bounded
  playback for a selected question and an explicit full-interview mode.

## Workflow

- [x] Intake and repository audit
- [x] Current provider/API research
- [x] Complete visible HireCall rebrand
- [x] Consolidate integration presentation and source documentation
- [x] Implement chaptered replay and shared seek controls
- [x] Refine integration GitHub issues
- [x] Run automated validation
- [ ] Run signed-in browser validation
- [x] Review and simplify
- [x] Commit and open PR

## Decisions

- Use `HireCall` as the product spelling and `hirecall.ai` in display-only URL
  examples.
- Preserve `@prelude/*`, environment variable names, database names, internal
  type names and migration history in this pass.
- Request Google scopes incrementally by capability. Calendar and Gmail must
  remain independently connectable even when they share one Google account.
- Treat LinkedIn and Indeed as partner-access integrations, not public-page
  scraping features.
- Store integration logos locally so settings do not depend on a third-party
  CDN at runtime.
- Derive chapter boundaries deterministically from persisted transcript turns;
  the next question start is the current question end.
- Keep one HTML audio element and one playback authority for the page.

## Validation target

- No user-visible Prelude brand remains in either app or notification output.
- Google Calendar connection and scheduling behavior remains unchanged.
- Integration rows use sourced logos and honest availability states.
- A replay chapter click seeks and starts at the expected question.
- Question playback pauses at that chapter's end and full playback remains
  available.
- Existing unit, typecheck and lint suites remain green.
- Desktop and mobile browser smoke tests show no overlap or horizontal scroll.

## Validation result

- `pnpm run test`: 19/19 tasks passed; console 356/356 non-live tests passed.
- `pnpm run typecheck`: 19/19 tasks passed.
- `pnpm run lint`: 19/19 tasks passed.
- `make test-services`: Go packages passed; Python 196/196 passed.
- A source audit found no remaining user-visible Prelude branding; stable
  technical identifiers are documented and intentionally retained.
- Signed-in visual and interaction smoke testing is pending because the
  in-app browser was not exposed to this Codex session.
