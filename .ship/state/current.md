# Current ship state

## Goal

Ship V1 copied-job-link intake so a recruiter can paste a LinkedIn, Indeed,
employer-career, ATS, or other public job URL and reach an editable role draft
or an immediate manual fallback without a dead end.

## Scope

- Preserve the existing SSRF-safe, robots-aware direct HTML importer.
- Route LinkedIn, Indeed, and unusable script-only pages through a verified
  indexed web-search adapter instead of scraping provider pages.
- Accept search-derived fields only when citations match the submitted job URL
  or its stable provider job identifier.
- Preserve acquisition strategy, field source, timestamp, and verified
  citations as recruiter-visible provenance.
- Keep every imported field editable and require recruiter review before
  question generation.
- Keep CI deterministic and free of paid network calls; real-link tests remain
  explicit opt-in smoke tests.

## Workflow

- [x] Intake and repository audit
- [x] Provider/API and policy research
- [x] Refine implementation ticket #133
- [x] Add failing routing, verification, and failure tests
- [x] Implement acquisition router and indexed-search adapter
- [x] Extend provenance and recovery UX
- [x] Validate real LinkedIn, Indeed, and public-link paths
- [ ] Review, simplify, document, and merge

## Decisions

- Do not use LinkedIn Apply Connect or Indeed Job Sync for copied-link intake.
- Do not crawl LinkedIn or Indeed directly, collect provider credentials, or
  use undocumented provider endpoints.
- Use OpenAI Responses `web_search` only as an indexed-source adapter behind a
  provider-neutral interface.
- Fail closed when the result cannot be tied to the submitted source.
- Define "handled" as either a verified editable draft or a retained-URL manual
  fallback, not a claim that every private or expired page can be extracted.
- Keep raw pages and complete search responses out of persistence.

## Validation target

- LinkedIn and Indeed URLs normalize and route without a provider-blocked error.
- Search-derived content is rejected without exact source evidence.
- Direct public HTML import behavior and SSRF controls remain unchanged.
- Errors are stable, actionable, and retain the submitted URL.
- Unit, typecheck, lint, and focused browser smoke tests pass.
- Live smoke tests cover representative LinkedIn, Indeed, and ATS URLs when
  `ALLOW_LIVE_JOB_URL_TESTS=1`.

## Validation result

- Mocked console suite: 371 passed, 6 skipped.
- Live indexed-source smoke: current LinkedIn job `4436807221` and current
  Indeed job `f066959d3108e72b` both produced an exact-source draft.
- Live direct-source smoke: current Greenhouse job `4911620101` produced a
  structured draft through the robots-aware HTML importer.
- Contracts and console TypeScript checks passed.
- Console ESLint and production build passed.
- Browser runtime was unavailable in the active Codex session; server and
  worker startup were checked locally, with the UI interaction smoke still to
  be completed if the runtime becomes available before merge.
