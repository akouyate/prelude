# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current implementation slice:
GitHub issue #59, live runtime evidence attached to product candidate sessions.

## Scope

- `CandidateSession` remains the durable product record for recruiter review.
- Runtime evidence is resolved from `CandidateSession.realtimeSessionId` to
  persisted `live_interview_sessions` and append-only `live_interview_events`.
- Console now reconstructs transcript turns and Q/A groups from persisted
  provider-neutral events, supporting both snake_case and camelCase payloads.
- Candidate detail now shows a runtime evidence card with status, runtime
  status, terminal event, event count, transcript turns, Q/A groups, question
  completion, and a transcript preview.
- Evidence status prefers persisted runtime terminal events
  (`session_completed`, `session_failed`) and runtime status before falling back
  to product session status, so completion is derived from persisted data rather
  than browser-local state.

## Phases

- [x] Intake
- [x] Skill loading
- [x] Repository investigation
- [x] Architecture review
- [x] Plan
- [x] Team decision
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [ ] Delivery

## Direction

- #59 completes the product-safe evidence bridge needed before #60 can generate
  persisted AI briefs.
- Keep provider metadata secondary; transcript and status are reconstructed from
  normalized business events.
- Continue to #60 only after this slice is merged and the recruiter detail can
  display real persisted runtime evidence.

## Validation

- `pnpm --dir apps/console run test`: passed, 2 files / 7 tests.
- `pnpm --dir apps/console run typecheck`: passed.
- `pnpm --dir apps/console run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm run test`: passed.
- `pnpm --dir apps/console run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- #60 owns persisted `CandidateBrief` generation from the runtime evidence.
- #61 owns real-data candidate list/detail polish after briefs exist.
- #62 owns the full E2E smoke/demo script across recruiter creation, candidate
  live interview, evidence, brief, and review.
