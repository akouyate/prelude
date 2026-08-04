# Candidate live preview

## Product decision

HireCall previews the real candidate application instead of maintaining a
second recruiter-only rendering. The console saves the current draft, creates
an immutable short-lived snapshot, and redirects to `/preview/:token` in the
candidate app. This keeps the welcome, setup, consent, form fallback, LiveKit
room, transcript UI, and responsive behavior on the same production code path.

## Isolation contract

- Preview bearer tokens contain 256 bits of entropy; Postgres stores only their
  SHA-256 digest.
- Preview access lasts 30 minutes. A started live test can run for 45 minutes.
- A preview never creates a `CandidateSession`, candidate invitation, billing
  admission, recruiter notification, candidate brief, or audio recording.
- Form answers complete in the browser and are not submitted to product APIs.
- Realtime sessions are explicitly marked `kind=preview`; the Go recording
  guard refuses LiveKit egress for that kind even if consent or entitlement
  data is accidentally present.
- Preview events and temporary transcripts are purged by the always-on realtime
  service after expiry. The console's bounded cleanup remains a secondary
  backstop.
- Reconnects reuse the current preview room and do not spend another live-test
  attempt. Failed realtime provisioning releases its optimistic reservation.
- Production candidate URLs must use HTTPS because the opaque bearer token is
  carried in the URL path.

## Operational checks

The browser smoke must cover the redirect, exit-to-draft link, form completion,
mobile layout, and one real LiveKit session provisioning. Database assertions
must confirm that product candidate and invitation counts are unchanged and
that no preview recording exists.

