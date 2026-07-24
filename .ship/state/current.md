# Current ship state

## Goal

Ship GitHub issue #103: use Clerk Billing as the source of truth for
organization plans while Prelude owns usage counters and entitlement
enforcement.

## Scope

- Normalize Clerk organization subscriptions into a small Prelude plan/status
  contract.
- Keep a minimal local projection for public candidate admission and
  cross-service checks.
- Replace placeholder Settings billing data with real state, usage and limits.
- Gate new published roles, candidate-session starts and audio recording on the
  server.
- Keep local/mock development honest and unmetered when Clerk Billing is not
  configured.

## Workflow

- [x] Intake, repository investigation and Clerk documentation research
- [x] Architecture, product and QA refinement
- [x] Architecture decision and TDD matrix
- [x] Implement billing domain, projection and Clerk adapter
- [x] Implement Settings billing UI and portal handoff
- [x] Implement role, candidate-session and recording enforcement
- [x] Review, simplify and validate
- [ ] Deliver PR and close the issue

## Decisions

- Clerk owns subscription/payment state; Prelude stores only a derived,
  privacy-minimal projection and product usage.
- Clerk's default organization plan maps to Prelude Free. The paid plan slug is
  configurable and defaults to `v1-workspace`.
- `past_due`, missing, unknown and provider-error states fail closed in
  production. A canceled paid item remains entitled only until its period end.
- Usage is derived from product rows. Candidate admission uses a serializable
  transaction so concurrent final-slot attempts cannot exceed the limit.
- Existing drafts and completed work stay accessible. Limits apply to newly
  published roles, new candidate starts and recording creation.
- Recording requires both candidate consent and a persisted per-session
  entitlement.
- Role creation, AI generation, editing, publication and reactivation share the
  same owner/admin/recruiter permission and publication admission policy.
- A safe Free projection is created during onboarding and reconciled from
  Clerk, so webhook delivery order cannot strand a new organization.
- Paid projections fail closed at period end or after a bounded reconciliation
  age. Future paid items cannot override an active Free plan early.

## Validation target

- Pure policy tests cover every supported Clerk state and unknown input.
- Adapter/webhook tests make no live paid Clerk calls.
- Server tests cover organization isolation, quota boundaries, retries,
  realtime failure and recording denial.
- Browser smoke verifies local placeholder and configured billing fixtures.
- Monorepo tests, lint, typecheck, Go tests and relevant builds are green.
- A real PostgreSQL final-slot smoke proves two concurrent Free starts at usage
  four produce exactly one session and one quota rejection.
