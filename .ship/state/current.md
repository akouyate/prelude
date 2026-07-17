# Current ship state

## Goal

Ship GitHub issue #65: transactional email infrastructure with Resend and React
Email.

## Scope

- Add a shared, server-only notification package that candidate and console
  workflows can call after durable state changes.
- Send a candidate confirmation only after completed consented sessions, and
  recruiter brief-ready or actionable brief-failure updates only when the
  workspace has enabled review notifications.
- Persist an idempotent delivery outbox record and immutable provider attempts.
- Keep Resend disabled unless explicitly enabled; tests and normal local smoke
  use a fake provider and never hit a live email API.

## Workflow

- [x] Intake, repository investigation, and existing-settings audit
- [x] Architecture review and delivery-contract refinement
- [x] Implement durable outbox, provider boundary, and templates
- [x] Connect candidate completion and brief generation workflows
- [x] Add mocked tests and a non-live smoke path
- [x] Review, simplify, and validate

## Validation

- `pnpm test` passed: 17 Turbo tasks completed; 62 candidate, 274 console,
  382 core, 69 contract, 12 notification, and package UI/database tests passed.
  Four explicitly live LLM tests remained skipped by design.
- `pnpm lint` passed: all 17 Turbo tasks completed.
- Targeted typechecks passed for `@prelude/notifications`, `@prelude/console`,
  and `@prelude/candidate`.
- `prisma validate` passed and `prisma migrate status` reported the local
  PostgreSQL schema up to date (25 migrations).
- `git diff --check` and Prettier checks for all parser-supported changed files
  passed.
- Notification smoke uses a fake provider. `NOTIFICATIONS_ENABLED` stays `0`,
  so this delivery did not send live email.

## Review decisions

- Use the existing workspace settings as the V1 delivery policy. The former
  `interviewCompleted` setting becomes candidate completion confirmation;
  `screensReadyForReview` covers the recruiter brief-ready and actionable
  brief-failure messages. Generic recruiter "interview completed" mail is not
  sent because it would duplicate the brief-ready event.
- The database is the long-lived duplicate guard. Resend receives the same
  stable idempotency key for retries, but its 24-hour key retention is not used
  as Prelude's only guarantee.
- Notification sending runs after the underlying completion or brief state has
  committed and errors are persisted without failing the product workflow.
- The existing uncommitted Calendar migration is already applied locally. Its
  generated index rename remains in the later notification migration to keep
  Prisma's applied migration history immutable; it has no data effect.
