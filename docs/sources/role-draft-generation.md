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
- [OpenAI Model Spec: handling untrusted data](https://model-spec.openai.com/2025-09-12.html): job briefs and titles are structurally delimited as untrusted reference data; they cannot override generation instructions.

## Compliance Sources

- See [`docs/sources/compliance-guardrails.md`](compliance-guardrails.md).
- See [`docs/sources/evaluation-matrix.md`](evaluation-matrix.md).

## Role Intake

- A private `RoleIntake` pipeline now handles PDF/DOCX and public URL sources.
  It creates a visible Job only after recruiter review; the question generator
  receives the reviewed draft, never raw documents or raw HTML.
- `sourceAttachmentName` remains provenance only. URL-derived roles retain their
  canonical public source as Job provenance without treating it as an attachment.

## Test Rule

Automated tests and CI must not call paid LLM providers by default. The console
Playwright suite sets `INTERVIEW_DRAFT_GENERATOR=deterministic` so tests exercise
the same server action path with deterministic output.
