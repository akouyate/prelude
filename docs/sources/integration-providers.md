# Integration provider sources

Reviewed on 2026-07-29 for HireCall's V1 integration roadmap.

## OAuth and capability boundaries

- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
  recommends incremental authorization: request a scope when the user invokes
  the feature that needs it, inspect the granted scopes, and keep refresh tokens
  in secure long-term storage.
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
  reinforce least-privilege scopes, contextual consent, encrypted token storage,
  revocation and graceful handling of partial consent.
- [Gmail server-side authorization](https://developers.google.com/workspace/gmail/api/auth/web-server)
  uses the same authorization-code flow as Calendar, but Gmail remains a
  separate HireCall capability and consent action.
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
  classify `gmail.send` as a sensitive scope. It is the narrowest capability
  for sending recruiter-authored messages; HireCall must complete Google's
  verification before enabling it publicly and must not request read or modify
  scopes for the V1 send-only workflow.

HireCall therefore keeps one Google connected account per user while tracking
Calendar and Gmail as independently granted capabilities. Connecting Calendar
must never silently grant Gmail access.

## Job-board access

- [LinkedIn Apply Connect](https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-apply-connect-jobs)
  restricts Job Posting API access to approved Talent Solutions partners and
  requires a partner agreement.
- [Indeed Job Sync](https://docs.indeed.com/job-sync-api) is intended for ATS
  partners, not direct employers, and requires partner-issued OAuth
  credentials. Direct employers use feeds instead.

HireCall must not scrape authenticated LinkedIn or Indeed pages. Their settings
rows stay unavailable until partner access, credentials, webhook contracts and
data-retention rules are approved.

## Brand assets

- LinkedIn icon: supplied from the
  [LinkedIn brand downloads](https://brand.linkedin.com/downloads) geometry
  already approved for this product.
- Indeed, Google Calendar, Gmail and Greenhouse icons:
  [Simple Icons](https://github.com/simple-icons/simple-icons), downloaded as
  local SVGs on 2026-07-29 using each brand's canonical color.
- Microsoft Teams icon:
  [Microsoft Teams 2025-present](https://commons.wikimedia.org/wiki/File:Microsoft_Office_Teams_%282025%E2%80%93present%29.svg),
  sourced from Microsoft 365 and stored locally.

Assets are served from the application so settings rendering does not depend on
a third-party CDN.
