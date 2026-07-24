# Current ship state

## Goal

Ship GitHub issue #117: safely import a public job URL into an editable role
draft.

## Scope

- Extend the private `RoleIntake` aggregate with a URL source variant while
  retaining the existing file-import lifecycle.
- Retrieve exactly one public job page in the durable worker through a pinned,
  policy-controlled HTTPS client; never use the recruiter session or a browser.
- Extract bounded, deterministic static HTML text and provenance, then require
  recruiter review before the existing interview-question builder can open.
- Keep LinkedIn/Indeed, authenticated content, crawling, previews, OCR and LLM
  source extraction out of scope.

## Workflow

- [x] Intake, repository investigation and issue refinement
- [x] AI/data-quality and backend/security architecture reviews
- [x] Architecture decision and test matrix
- [x] Implement contracts, schema and URL source policy
- [x] Implement safe outbound retrieval and deterministic extraction
- [x] Implement worker, actions and reusable review UI
- [x] Test, security review, simplify and validate
- [ ] Deliver PR and close the issue

## Decisions

- `RoleIntake` remains private staging; only a recruiter-approved
  `reviewedDraft` can create one `Job`.
- URL acquisition runs as a durable, leased worker task and is a distinct port
  from PDF/DOCX storage, scanning and parsing.
- Requests are HTTPS-only with a public-DNS check on every hop and the selected
  address pinned into the TLS connection to prevent DNS rebinding.
- The extractor is deterministic and non-executing. Raw HTML, IPs, headers and
  remote responses are not persisted or handed to the question-generation LLM.
- A controlled provider policy blocks LinkedIn and Indeed. `robots.txt` is
  honored through the same outbound boundary; failure falls back to manual.

## Validation target

- Unit tests inject resolver, transport, robots policy and clock. CI has no
  external web or LLM call.
- Tests cover special/private IPs, redirects, robots, limits, hostile markup,
  deterministic extraction, idempotency, review revisions and one Job creation.
- Local smoke imports a public job page through the worker, reviews the draft,
  creates one role with URL provenance, then cleans up its test data.
