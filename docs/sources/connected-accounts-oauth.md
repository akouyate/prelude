# Connected Accounts OAuth Sources

## Google OAuth foundation

- Google Identity: “Using OAuth 2.0 for Web Server Applications”
  https://developers.google.com/identity/protocols/oauth2/web-server
- Google Calendar: “Choose Google Calendar API scopes”
  https://developers.google.com/workspace/calendar/api/auth

## Applied decisions for Prelude V1

- Use first-party OAuth for V1 instead of Nango/Nylas/Paragon. This keeps
  provider behavior, cost, scopes, and product state under Prelude control.
- Treat Google as a user-level connected account inside one Prelude
  organization. Organization-level reuse must be an explicit future workflow.
- Keep OAuth code exchange, refresh, revoke, and token storage server-side only.
- Store only encrypted token material in Postgres.
- Request identity scopes plus `https://www.googleapis.com/auth/calendar.events`
  only when the recruiter connects Google Calendar. Do not request Gmail scopes
  in #104.
- Use provider adapters so later tickets can add Google Calendar scheduling,
  Gmail discovery, Microsoft, LinkedIn, and Indeed without duplicating OAuth
  state and token handling.
