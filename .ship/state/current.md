# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current implementation slice:
GitHub issue #61, real-data recruiter dashboard and candidate review.

## Scope

- Recruiter dashboard metrics and queues stay organization-scoped and DB-backed.
- “Needs review” now counts completed sessions still owned by the human review
  state, instead of every completed session.
- Dashboard primary review CTA links to the real completed candidate session,
  using the candidate session id when a realtime id is unavailable.
- Candidate review detail no longer fetches or displays non-persisted runtime
  summary content as a fallback.
- Candidate review detail resolves only real organization-scoped
  `CandidateSession` records; orphan `LiveInterviewSession` records no longer
  produce a recruiter review page.
- The obsolete mock recruiter summary fixture was removed so review pages cannot
  accidentally fall back to product mock content.

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

- #61 tightens the recruiter review workflow around persisted product data after
  #60 introduced `CandidateBrief`.
- The detail page now shows persisted brief, explicit pending/failed states, and
  durable runtime evidence only.
- Continue to #62 after merge for a repeatable local E2E smoke/demo script.

## Validation

- `pnpm --dir apps/console run test`: passed, 3 files / 9 tests.
- `pnpm --dir apps/console run typecheck`: passed.
- `pnpm --dir apps/console run lint`: passed.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm run test`: passed.
- `pnpm --dir apps/console run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- #62 owns the full E2E smoke/demo script across recruiter creation, candidate
  live interview, evidence, brief, and review.
- #63 owns human notes and review status mutation controls.
