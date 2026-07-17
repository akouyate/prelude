# Transactional notifications sources

## Primary sources

- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
  documents the 24-hour provider deduplication window and the SDK's stable
  idempotency key support. Prelude also persists delivery state, so a provider
  key is not the only duplicate guard.
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
  documents server-side React email sending and provider message identifiers.
- [React Email + Resend](https://react.email/docs/integrations/resend) documents
  versioned React templates passed directly to the Resend Node SDK.
- [Resend webhook semantics](https://resend.com/docs/webhooks/introduction)
  documents at-least-once and out-of-order webhook delivery. Webhook ingestion
  is intentionally deferred from this V1 foundation.

## Prelude decisions

- Product emails are sent from Resend, not a recruiter's Gmail identity.
- Email delivery is an explicit opt-in service configuration. Local and CI use
  a disabled or fake provider and do not make network calls.
- Candidate confirmation contains no AI analysis or decision. Recruiter mail is
  limited to a role/candidate context and a console link; it never embeds the
  underlying evidence or recommendation.
