# Role Draft Generation Sources

This document tracks implementation rationale for the role-screen draft generator.
It is product and engineering guidance, not legal advice.

## Product Rule

- Prelude generates a first-screen role interview, not a full hiring interview.
- The recruiter does not choose the question count manually.
- The generator targets 3 to 5 planned questions:
  - 3 for simple junior or low-ambiguity roles.
  - 4 for most V1 role screens.
  - 5 only for senior, complex, cross-functional, or high-ambiguity roles.
- Recruiters may edit, replace, regenerate, remove, or add questions, but the
  V1 plan remains capped at 5 planned questions.

## OpenAI Implementation Sources

- [OpenAI Responses API: create a response](https://platform.openai.com/docs/api-reference/responses/create)
- [OpenAI structured outputs guide](https://platform.openai.com/docs/guides/structured-outputs)

## Compliance Sources

- See [`docs/sources/compliance-guardrails.md`](compliance-guardrails.md).
- See [`docs/sources/evaluation-matrix.md`](evaluation-matrix.md).

## Attachment Ingestion (Deferred)

- The generator and prompt already consume `sourceAttachmentName` so an
  attachment-derived brief can be tailored once one exists.
- There is intentionally **no** upload UI or setter in the role builder yet. A
  real upload -> blob storage -> parse -> `sourceAttachmentName` pipeline is out
  of scope for the current console work because it needs blob storage that is
  not yet provisioned.
- Attachment ingestion will be handled by a separate, future flow. Until then
  `sourceAttachmentName` is populated only by persisted/legacy drafts and is
  surfaced read-only ("Attachment-aware" vs "Job brief only" badge).

## Test Rule

Automated tests and CI must not call paid LLM providers by default. The console
Playwright suite sets `INTERVIEW_DRAFT_GENERATOR=deterministic` so tests exercise
the same server action path with deterministic output.
