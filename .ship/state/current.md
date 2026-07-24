# Current ship state

## Goal

Ship the engineering foundation for GitHub issue #121: measure PDF/DOCX
role-intake quality and make a controlled pilot auditable.

## Scope

- Keep `RoleIntakeEvent` as the first-party telemetry boundary.
- Enforce typed, privacy-safe structural metadata for the required lifecycle
  events.
- Restrict production pilot access to at most five explicitly opted-in
  organizations.
- Add a deterministic, non-customer English/French fixture corpus and quality
  scorecard with no LLM or external network dependency.
- Report sample-dependent release gates as insufficient until real pilot data
  exists; never manufacture a successful 50-document pilot.

## Workflow

- [x] Intake, repository investigation and issue review
- [x] Primary-source research and architecture/data challenges
- [x] Architecture decision and TDD matrix
- [x] Implement typed telemetry and pilot cohort policy
- [x] Implement corpus, deterministic scorer and pilot scorecard
- [x] Instrument the durable worker, review and conversion lifecycle
- [x] Test, privacy review, simplify and validate
- [ ] Deliver PR; keep the real-pilot gate explicit

## Decisions

- No PostHog, Segment, OpenTelemetry SDK or LLM benchmark is added.
- Event metadata is built from per-event allowlists; document text, filenames,
  URLs, hashes, parser messages and candidate data are forbidden.
- A production environment allowlist fails closed and accepts at most five
  organization IDs. Local development can remain usable without a cohort.
- Fixture quality is compared with normalized fields and required fact groups,
  not raw full-text equality.
- Product gates that require 50 human-reviewed documents or a matched manual
  baseline remain `insufficient_data` until those observations exist.

## Validation target

- Unit tests cover event schemas, privacy, bucket boundaries, durations, cohort
  policy, corpus outcomes, p95/median calculations and insufficient-data gates.
- Service tests assert the exact structural event sequence for clean, infected,
  no-text, corrupt, retry, review, conversion and cleanup paths.
- QA runs the focused suite, full console suite, lint/typecheck and one real
  PDF/DOCX intake smoke without external analytics or LLM calls.
