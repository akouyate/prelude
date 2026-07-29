# Clerk Billing implementation sources

Checked on 2026-07-24.

## Primary sources

- [Clerk Billing for B2B SaaS](https://clerk.com/docs/nextjs/guides/billing/for-b2b)
  documents organization plans, features, `has()` checks and the organization
  pricing surface.
- [Clerk Billing webhooks](https://clerk.com/docs/react/guides/development/webhooks/billing)
  documents subscription and subscription-item lifecycle events.
- [Clerk webhook overview](https://clerk.com/docs/guides/development/webhooks/overview)
  documents signed Svix delivery and retry behavior.
- [Organization billing subscription](https://clerk.com/docs/reference/backend/billing/get-organization-billing-subscription)
  documents the canonical Backend API lookup used to refresh HireCall's local
  projection.
- [Default plans](https://clerk.com/docs/guides/billing/default-plans) documents
  that every organization receives Clerk's default free plan.
- [Custom plans and plan transitions](https://clerk.com/docs/guides/billing/custom-plans)
  documents scheduled subscription changes, including upcoming items.
- [Organization profile](https://clerk.com/docs/reference/components/organization/organization-profile)
  documents Clerk's existing plan, payment-method and statement management
  surface.
- [Authorization checks](https://clerk.com/docs/guides/secure/authorization-checks)
  recommends server-side feature checks. HireCall cannot rely on session
  `has()` alone because candidate admission is a public, unauthenticated flow.

## Applied constraints

- Clerk remains the billing authority. HireCall does not store payment methods,
  invoices, amounts or raw webhook payloads.
- The local projection exists for low-latency public admission and
  cross-service enforcement, not as an independent subscription ledger.
- Webhook application is idempotent and ignores stale source updates.
- Organization onboarding seeds only the safe default Free projection, then
  reconciles Clerk canonically. This closes the race where a webhook arrives
  before HireCall has persisted the organization.
- Paid projections fail closed at their period end or after a bounded
  reconciliation age. Canceled paid access becomes Free after period end.
- A future paid item never overrides an active default Free item before its
  start date.
- Clerk Billing APIs are marked beta in the installed SDK, so provider-specific
  types stay behind a small adapter and the dependency is pinned.
