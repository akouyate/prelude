# Ship State

## Objective

Ship the V1 E2E workflow step by step, starting with GitHub issue #57:
create and publish a real live interview plan, then continue through candidate
link, evidence, brief, review, smoke, refactor, and polish.

## Scope

- Treat #57 as the first implementation slice because it produces the stable
  published interview link required by #58-#62.
- Keep #64 minimum compliance gates inside the relevant P0 slices instead of
  deferring them: disclosure/consent copy and disallowed-analysis guardrails
  must be present before publishing or starting a candidate flow.
- Preserve organization-scoped reads/writes through existing
  `getCompletedOrganizationScope()` while #55 policy tests remain a follow-up.
- Keep the release state real-data oriented: `Job` -> `InterviewDraft` ->
  published `Interview` -> public token.

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

- #57 should harden the publish contract first: 3-5 questions, 3-5 criteria,
  allowed response modes, stable snapshot, and compliance guardrails.
- Keep advanced builder polish out of scope; use the existing focused wizard.
- Add a pure policy module with unit tests so publication rules are not just UI
  affordances.
- Continue to later slices only after each slice has validation evidence.

## Validation

- `pnpm --dir apps/console run test`: passed, including
  `interview-plan-policy.test.ts`.
- `pnpm --dir apps/console run typecheck`: passed.
- `pnpm --dir apps/console run lint`: passed.
- `pnpm --dir apps/candidate run test`: passed, 2 files / 9 tests.
- `pnpm --dir apps/candidate run typecheck`: passed.
- `pnpm --dir apps/candidate run lint`: passed.
- `go test ./...` from `services/realtime`: passed, 42 tests.
- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm run test`: passed.
- `pnpm --dir apps/console run build`: passed.
- `pnpm --dir apps/candidate run build`: passed.
- `git diff --check`: passed.

## Known Follow-Up

- #55 still needs explicit policy tests for wrong organization access.
- #58 still owns candidate identity/consent/resume UX; this slice only blocks
  unknown tokens from silently starting demo sessions.
- #60 still owns persisted CandidateBrief; recruiter detail still uses realtime
  summary until that slice lands.
