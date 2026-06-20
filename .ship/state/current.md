# Ship State

## Objective

Ship the new UI/UX experience of the candidate webapp, aligned with the Claude
Code candidate redesign reference and plugged into the real candidate API flow.

## Scope

- Used `/Users/adrienkouyate/Downloads/Candidate web app redesign/Candidate Experience.dc.html`
  as the UX reference after the user pointed to it.
- Reworked the candidate interview flow into clear steps:
  - welcome screen
  - setup / consent screen
  - focused live interview screen
  - completion screen
- Aligned candidate app typography and shell with the console design direction:
  Geist body, Plus Jakarta Sans titles, Instrument Serif italic accent,
  charcoal primary actions, subdued olive accents, light warm surfaces, and no
  card shadows.
- Made the live interview voice-first by default, with camera optional when the
  published interview allows video.
- Removed candidate-facing LiveKit room IDs and other technical room language.
- Kept the existing API contract:
  - `POST /api/live-interview-sessions`
  - `POST /api/live-interview-sessions/:sessionId/events`
  - `POST /api/candidate-sessions/:sessionId/complete`
- Added `apps/candidate/e2e/fake-realtime-server.mjs` so Playwright can exercise
  the real Next.js candidate API routes without external LiveKit/realtime infra.
- Updated candidate E2E to stop intercepting candidate app API routes in the
  browser. The happy path now creates a product candidate session, bridges
  through the Next API, posts candidate-ready events, and completes the product
  session.
- Refactored candidate LiveKit/API transport out of the main presentation
  component into `live-interview-client.ts`, with shared types in
  `live-interview-types.ts`.
- Added unit coverage for the extracted candidate client handshake:
  session creation, mock-room readiness events, product-session completion,
  media cleanup, resume storage key, and candidate-facing error mapping.
- Polished the start flow so candidates see the focused connecting state
  immediately after tapping start, and guarded the start handler against invalid
  names in addition to the disabled button state.
- Captured screenshots for desktop and mobile:
  - `/tmp/prelude-candidate-welcome.png`
  - `/tmp/prelude-candidate-setup.png`
  - `/tmp/prelude-candidate-live.png`
  - `/tmp/prelude-candidate-complete.png`
  - `/tmp/prelude-candidate-mobile-welcome.png`
  - `/tmp/prelude-candidate-mobile-setup.png`
  - `/tmp/prelude-candidate-mobile-live.png`

## Phases

- [x] Intake
- [x] Repository investigation
- [x] Reference design review
- [x] Plan
- [x] Execution
- [x] Testing
- [x] Visual review
- [x] Final review
- [x] Delivery

## Validation

- `pnpm --dir apps/candidate typecheck`: passed.
- `pnpm --dir apps/candidate lint`: passed.
- `pnpm --dir apps/candidate test`: passed, 4 files / 17 tests.
- `pnpm --dir apps/candidate test:e2e`: passed, 2 mobile Chromium tests.
- `pnpm --dir apps/candidate build`: passed.
- `git diff --check`: passed.

## Remaining Follow-Up

- Decide whether to keep camera as an optional mode in the candidate setup or
  make this first released candidate app strictly audio-only.
