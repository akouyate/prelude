# Google Calendar scheduling sources

Prelude's V1 scheduling implementation is based on these official Google
Calendar API references.

- [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events): `primary` calendar selection, timed-event fields, caller-generated event identifiers, attendees, and `sendUpdates` behavior.
- [Events: insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert): Calendar Events REST endpoint and `conferenceDataVersion=1` support for a `conferenceData.createRequest`.
- [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors): refresh after a `401`, reconnect if refresh fails, and use bounded backoff for rate-limit or backend errors.

## Prelude policy

- Events are created in the connected recruiter's `primary` calendar.
- Candidate and guest invitations are sent only when the recruiter explicitly
  includes their email address. Private events use `sendUpdates=none`.
- Interview analysis, evidence, recruiter notes, and internal Prelude links are
  never included in the Google event description. Prelude stores its candidate
  session reference only as a private Google event property.
- A retry retains the original date, attendees, invitation choice, location,
  and conference request. Prelude reconciles a caller-generated event ID on a
  Google `409` rather than creating a duplicate or changing an event whose
  initial write may already have succeeded.
