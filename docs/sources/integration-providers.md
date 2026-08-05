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
- [Indeed Job Sync](https://docs.indeed.com/job-sync-api) covers creating,
  updating and expiring postings and is open to direct employers as well as ATS
  partners; it requires OAuth credentials issued by Indeed.
- [Indeed Job Update](https://docs.indeed.com/job-update-api/) reads job details
  and lists postings on behalf of a connected Indeed account, through
  three-legged OAuth.
- Reading an Indeed or LinkedIn job page directly is not possible and not a
  matter of effort: both refuse server-side retrieval, and both disallow the
  path in `robots.txt`. Measured 2026-08-05, `fr.indeed.com/viewjob` answers 403
  behind a bot challenge.
- Welcome to the Jungle allows the path in `robots.txt` but sits behind the same
  class of bot management: measured 2026-08-05, a server-side request answers
  202 then 403 with an empty body, so no structured data is reachable. The
  indexed-search fallback does not rescue it either, so its links fail closed.
- LinkedIn is the one blocked source the indexed-search fallback does resolve:
  measured 2026-08-05, a `jobs/view/{id}` link returned a complete draft with a
  citation matching the exact job id. It is the most fragile path in the
  importer — it costs a model call per import and depends on the posting being
  in the public index.

HireCall must not scrape authenticated LinkedIn or Indeed pages. Their settings
rows stay unavailable until partner access, credentials, webhook contracts and
data-retention rules are approved.

## Applicant tracking system job boards

Hosted ATS boards publish each posting through an unauthenticated JSON API, so
importing one needs no partnership, credential or agreement.

- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html):
  `boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}` returns title, location
  and content. The content field arrives HTML-escaped.
- [Lever Postings API](https://github.com/lever/postings-api):
  `api.lever.co/v0/postings/{site}/{id}` splits a posting across an intro,
  titled list sections and a closing block.
- [Ashby Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api):
  `api.ashbyhq.com/posting-api/job-board/{name}` publishes a whole board; the
  board page itself is client-rendered and therefore unreadable as HTML.

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
