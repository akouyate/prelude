# Role intake sources

- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): the browser receives a short-lived signed PUT URL, while R2 credentials remain server-side. The signed content type is verified when the object is finalized.
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/): the private bucket must allow the console origin to `PUT` role uploads with the `content-type` request header.
- [Railway Docker Compose service mapping](https://docs.railway.com/guides/docker-compose): Railway services should run as independently configured private services rather than expose the scanner publicly.
- [Official ClamAV Docker image](https://hub.docker.com/r/clamav/clamav): local development uses the maintained ClamAV daemon image behind the optional `role-intake` Docker profile.
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): URL imports validate every DNS answer, reject non-public address ranges and keep redirect handling under application control.
- [Node.js HTTP request options](https://nodejs.org/api/http.html#httprequestoptions-callback) and [Node.js DNS lookup](https://nodejs.org/api/dns.html#dnspromiseslookuphostname-options): the importer resolves all addresses, then pins one validated address into the TLS request rather than letting a later hostname lookup bypass validation.
- [RFC 9110 redirects](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4): every redirect target is an independent request URI and is therefore parsed and validated again.
- [RFC 9309 robots](https://www.rfc-editor.org/rfc/rfc9309.html): the importer
  keeps its established `PreludeRoleImporter` crawler token across the HireCall
  product rebrand and honors the matching `robots.txt` policy before retrieving
  a job page.
- [schema.org JobPosting](https://schema.org/JobPosting) and
  [Google job posting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting):
  a board that wants its offers indexed publishes them as JSON-LD, so the
  importer reads that structured record before falling back to visible text.
  `@type` is accepted bare or fully qualified, and the posting is located
  anywhere in the document graph.
- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html),
  [Lever Postings API](https://github.com/lever/postings-api) and
  [Ashby Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api):
  hosted ATS boards answer with the posting itself over an unauthenticated JSON
  endpoint, which is preferred over reading the same content back out of the
  board markup. Ashby's board page is client-rendered, so its API is the only
  readable form.
- [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search):
  provider pages that cannot be fetched by the first-party importer use the
  Responses API search index with cited sources. HireCall accepts the result
  only when a citation matches the exact LinkedIn job ID or the submitted public
  URL.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  indexed extraction uses a strict JSON schema, bounded output, and `store:
false`; missing or unverifiable fields fail closed instead of being inferred.
- [LinkedIn robots policy](https://www.linkedin.com/robots.txt): HireCall does
  not crawl LinkedIn pages. LinkedIn URLs are resolved through the cited search
  adapter and retain the original link when indexed content is unavailable.
- [W3C WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages): asynchronous upload and extraction updates use a polite status region, so progress is announced without moving focus.
- [GOV.UK file upload](https://design-system.service.gov.uk/components/file-upload/): the upload surface keeps a native file input, a visible drag target, explicit constraints and contextual errors.
- [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/): extracted role fields require an explicit recruiter review before a Job is created, and previously extracted values remain editable.

The importer deliberately does not use OCR, browser automation, public preview
URLs, or a document download endpoint. PDF/DOCX input is malware-scanned before
deterministic extraction. A hosted ATS board is read through the platform's own
public JSON API; every other public career page is retrieved once through a
bounded, non-executing HTML parser that honors robots policy. Both paths share
the same DNS pinning, redirect and response-size limits, and an ATS API that is
unavailable degrades to the page path rather than failing the import.

The ATS API path deliberately does not check `robots.txt`. RFC 9309 governs
crawling a site's pages, whereas these are documented JSON APIs intended for
programmatic use, and their hosts are a fixed set compiled into the resolver
rather than anything a recruiter supplies — so there is no crawl surface and no
SSRF surface for robots to police. Measured 2026-08-05, Greenhouse and Lever
allow these paths in `robots.txt` regardless, and Ashby answers 401 for
`/robots.txt`, which the page-path rule treats as a refusal.

LinkedIn and blocked or script-only pages use an opt-in OpenAI indexed-search
fallback.

HireCall only offers a source it can actually read. Indeed and Welcome to the
Jungle were measured as permanently unreadable, so their links are refused the
moment they are pasted, naming the source and pointing at file upload or manual
entry — a named limit reads as a boundary, whereas accepting a link and failing
at the end reads as a defect. The refusal lives in the intake URL policy so a
single rule governs every caller; the client-side brand list is display only and
never a second copy of it.

Only the extracted draft, source URL, acquisition strategy, and
verified citations are persisted; raw HTML, raw API payloads and raw search
responses are not.
Every result remains editable and requires explicit recruiter approval before a
Job is created.

Pilot telemetry is first-party and structural only. It records allow-listed event names, duration and size buckets, parser/scanner outcomes, changed field names and warning codes. It never records filenames, URLs, document text, extracted values, hashes, email addresses or candidate data.
