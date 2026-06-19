# Ship State

## Objective

Replace dashboard mocks with real entities for jobs, interview drafts, published
interviews, and candidate sessions.

## Scope

- Persist an interview draft per job instead of linking jobs to a demo session.
- Make `/interviews/new` save role brief, modes, questions, criteria,
  guardrails, and `draft` status.
- Show dashboard states from persisted interviews and candidate sessions:
  draft, published, candidate started, completed, and needs review.
- Build the interview detail page from database data first, with realtime summary
  enrichment only when a live candidate session exists.

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

- Keep the V1 implementation explicit and small: new persisted interview records
  rather than overloading the old `PreInterview` POC model.
- Store generated builder output as structured JSON for now, so product can
  iterate on question, criteria, and guardrail shape without migration churn.
- Keep Clerk organization scoping enforced through existing onboarding guards and
  organization membership lookups.
- Avoid a heavy dashboard redesign in this slice; replace fake links/states with
  real persisted data and keep the current clean visual language.

## Validation

- `pnpm run typecheck`: passed.
- `pnpm run lint`: passed.
- `pnpm --dir apps/console build`: passed.
- `pnpm --dir apps/candidate build`: passed.
- `pnpm --dir apps/candidate test`: 2 files, 8 tests passed.
- `git diff --check`: passed.
- Browser smoke:
  - `/` loads the persisted recruiter dashboard.
  - `/interviews/new?jobId=...` generates questions and saves a persisted
    `InterviewDraft`.
  - Publishing creates an `Interview` with a real `publicToken` and detail page.
  - Candidate API with the published token creates a `CandidateSession` linked
    to the interview.
  - `/interviews/:id` renders DB questions, criteria, candidate link, and
    candidate sessions without mock fallback.

## Known Follow-Up

- The Go realtime service still resolves the interview plan through its demo
  plan factory. Candidate sessions are now linked to the published interview,
  but making the live interviewer ask the persisted DB questions should be the
  next backend integration slice.
