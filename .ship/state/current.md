# Current ship state

## Goal

Ship a real candidate-experience preview that opens the candidate application
and can run an isolated LiveKit interview without creating product candidate
records or triggering billing, invitations, notifications, analysis, or audio
recording.

## Scope

- Save the recruiter draft before previewing so unsaved edits are included.
- Create a short-lived, opaque preview snapshot using the existing Interview
  plan contract consumed by the realtime service.
- Open the real candidate application at `/preview/:token`.
- Reuse the production welcome, preflight, consent, form, audio, reconnect, and
  completion UI.
- Provision preview LiveKit sessions without CandidateSession or invitation
  writes and without recording entitlement.
- Expire preview URLs and continuously purge stale snapshots and realtime evidence.
- Keep published-candidate behavior unchanged.

## Workflow

- [x] Audit candidate, console, realtime, billing, and recording boundaries
- [x] Challenge architecture and UX with specialized subagents
- [x] Choose the smallest isolated architecture
- [x] Add failing preview snapshot and session-isolation tests
- [x] Implement console snapshot action and candidate redirect
- [x] Implement candidate preview route and isolated live test
- [x] Allow realtime to resolve temporary preview plans
- [x] Remove the console-only fake preview and update E2E coverage
- [x] Run review, refactor, full validation, and browser smoke tests

## Decisions

- Use the real candidate application; do not maintain a second preview UI.
- Keep preview and live test explicit in the UI, but use the same candidate
  surface and runtime components.
- Use a temporary Interview snapshot rather than adding a second Redis plan
  repository. Interview is already the canonical contract read by Go realtime.
- Use opaque high-entropy tokens and server-side TTL checks; never encode draft
  content in a URL.
- Never call `prepareCandidateSession` for preview sessions.
- Never create CandidateSession, CandidateInvitation, CandidateBrief, billing,
  notification, calendar, or recording records for a preview.
- A preview realtime session uses an opaque `preview_*` candidate id and remains
  outside every product query because no CandidateSession references it.
- Preview reconnection reuses the existing room; failed provisioning releases
  its optimistic live-test reservation.
- The realtime service purges expired preview sessions, transcript events, and
  snapshots every five minutes and rejects events after session expiry.

## Validation target

- Preview opens the candidate app with the latest saved draft.
- Expired or unknown preview tokens fail closed with a clear unavailable state.
- Merely opening preview performs no candidate lifecycle write.
- Microphone permission is requested only after the recruiter explicitly starts
  the live test.
- The real agent joins and all connection/reconnection/completion states work.
- CandidateSession, invitation, billing, notification, analysis, and recording
  state remain unchanged.
- Published invitation and public-token flows retain their current behavior.
- Console, candidate, UI, realtime unit tests, typechecks, lint, and focused
  desktop/mobile browser smoke tests pass.

## Result

- Candidate app: 86 tests passed; console: 382 passed, 7 skipped; UI: 6 passed;
  core: 384 passed; contracts: 70 passed; realtime: 114 tests passed, including
  Postgres retention coverage.
- Candidate and console lint, TypeScript, and optimized Next.js production
  builds pass.
- Browser smoke passed for same-tab redirect, real welcome/setup UI, written
  fallback completion, exit-to-draft, and a mobile viewport.
- Real LiveKit provisioning returned a non-mock token. Product candidate and
  invitation counts stayed unchanged and preview recording count stayed zero.
