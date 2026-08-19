# Google Calendar scheduling sources

HireCall's V1 scheduling implementation is based on these official Google
Calendar API references.

- [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events): `primary` calendar selection, timed-event fields, caller-generated event identifiers, attendees, and `sendUpdates` behavior.
- [Events: insert reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert): Calendar Events REST endpoint and `conferenceDataVersion=1` support for a `conferenceData.createRequest`.
- [Events: patch reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch): patch semantics (omitted fields are left untouched), `sendUpdates`, and `conferenceDataVersion`.
- [Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors): refresh after a `401`, reconnect if refresh fails, and use bounded backoff for rate-limit or backend errors.

## HireCall policy

- Events are created in the connected recruiter's `primary` calendar.
- Candidate and guest invitations are sent only when the recruiter explicitly
  includes their email address. Private events use `sendUpdates=none`.
- Interview analysis, evidence, recruiter notes, and internal HireCall links are
  never included in the Google event description. HireCall stores its candidate
  session reference only as a private Google event property.
- A retry retains the original date, attendees, invitation choice, location,
  and conference request. HireCall reconciles a caller-generated event ID on a
  Google `409` rather than creating a duplicate or changing an event whose
  initial write may already have succeeded.

## Rescheduling policy

A reschedule **patches the event Google already holds**; it never deletes and
recreates one. The event id, the invitation thread it belongs to, and any RSVP
the candidate has already given all survive a patch — a recreate would throw
them away and land in the candidate's inbox as a brand-new, unrelated
invitation for a meeting they had already accepted.

- The patch is sent to `events.patch`, so the fields HireCall does not send are
  left as they are. That is what keeps the event description empty and the
  private HireCall session reference attached across a move.
- `conferenceDataVersion=1` is set on **every** patch, including the ones that
  ask for no conference at all. Google documents version 0 as assuming a client
  with no conference-data support and ignoring conference data in the event
  body, so a version-0 patch answers without the Meet link — and HireCall would
  store a null join URL for an event that still has one. Version 1 is safe
  because the request body carries a `conferenceData` key only when a new
  conference is actually requested.
- `sendUpdates` follows the same rule as a creation: `all` when the event has
  guests, `none` when it is private. A meeting that moved without telling
  anybody is worse than a meeting that never moved.
- Only the recruiter who booked the call can move it (`not_calendar_owner`).
  The Calendar connection is per user, so a teammate's token addresses their
  own `primary` calendar — not the one holding the event.

### A reschedule may add, and may never take away

HireCall refuses to remove a guest, or to remove the Google Meet link, from a
call that is already booked. Both refusals surface as `reschedule_unsupported`
and send the recruiter to Google Calendar, which the stored event URL links
straight to.

The reason is that neither removal is documented as notifying anyone. Google
documents `sendUpdates` as notifying the guests **of the event**, and documents
nothing about a guest that the same request has just dropped: a removal here
would un-invite somebody with no guarantee they are ever told, leaving them
holding an invitation to a meeting that no longer includes them. Clearing
`conferenceData` on a patch is likewise not documented behaviour, so a request
that tried it could not be trusted to have done it.

This is also why the scheduling dialog opens **prefilled** from the booked call
rather than empty. A submitted schedule is read as the complete state of the
event, so a guest missing from the form is a guest being removed — an empty
form would turn an ordinary "move this by an hour" into a refusal for something
the recruiter never asked for.
