# Ship State

## Objective

Ship the V1 E2E workflow step by step. Current implementation slice:
GitHub issue #60, persisted candidate brief generation after a completed live
interview.

## Scope

- `CandidateBrief` is generated from durable `CandidateSession` runtime
  evidence, scoped by organization.
- Generation is provider-agnostic through a `CandidateBriefSynthesizer`
  boundary and uses a local deterministic synthesizer in automated tests and
  local UI flow.
- Generation is idempotent through the unique `candidateSessionId` brief record:
  pending/processing/completed/failed states are written back to the same row.
- The persisted brief stores schema version, provider/model metadata, summary
  JSON, limitations, recommendation, and flattened evidence references.
- Recruiter detail prefers the persisted brief when available and only uses the
  runtime summary as a fallback before a brief is generated.
- Completed runtime evidence exposes a console action to generate or retry the
  persisted recruiter brief.

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

- #60 completes the first persisted analysis layer required for recruiter
  review.
- The current synthesizer is intentionally replaceable; a future OpenAI/Vertex
  adapter can implement the same `CandidateBriefSynthesizer` contract without
  changing the recruiter view.
- Automated tests do not call paid LLM providers.
- Continue to #61/#62 after merge for real-data dashboard polish and the full
  E2E smoke/demo script.

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

- #61 owns real-data candidate list/detail polish after persisted briefs exist.
- #62 owns the full E2E smoke/demo script across recruiter creation, candidate
  live interview, evidence, brief, and review.
- A paid/live LLM brief adapter should remain behind an explicit live/eval
  command or flag before being used outside local manual testing.
