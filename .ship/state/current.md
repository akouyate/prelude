# Current ship state

## Goal

Ship GitHub issue #116: secure PDF/DOCX role brief intake.

## Scope

- Add a private `RoleIntake` staging aggregate before a role is created.
- Upload a PDF/DOCX to a dedicated, quarantined R2 path, then scan and extract
  text in a private worker before recruiter review.
- Let an authorized recruiter edit the extracted job title, location and
  description, then create exactly one existing `Job` and enter the current
  question builder.
- Keep manual role creation unchanged and leave the feature disabled until
  explicitly configured.

## Workflow

- [x] Intake, issue refinement, product/data and backend challenge
- [x] Repository investigation and architecture decision
- [x] Implement `RoleIntake` contracts, migration and state policy
- [x] Implement private storage, scanner, extractor and durable worker
- [x] Implement upload/review UI and builder hand-off
- [x] Add tests, local environment, documentation and pilot instrumentation
- [x] Review, simplify and validate

## Decisions

- `RoleIntake` is a private staging object; it is not a visible role and cannot
  publish an interview.
- The worker uses a database-backed leased queue stored on `RoleIntake`, not a
  new Redis dependency.
- PDF/DOCX parsing is deterministic and isolated behind scanner/extractor
  ports. OCR, previews, downloads and LLM extraction are out of scope.
- A successful intake creates a single `Job`, then redirects to
  `/roles/new?jobId=...`; the existing builder remains the sole owner of
  `InterviewDraft` creation.
- Upload is feature-flagged and requires dedicated R2 + ClamAV configuration.

## Validation target

- Unit tests mock storage, scanning and extraction; no network or paid LLM call
  occurs in CI.
- Integration tests cover lifecycle, authorization, retry and exactly-once job
  conversion.
- Local smoke uses Docker ClamAV plus an in-memory/test storage adapter when
  dedicated R2 credentials are unavailable.
