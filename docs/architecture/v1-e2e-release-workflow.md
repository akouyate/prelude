# V1 E2E Release Workflow

Issue map: #23, #37, #54, #55, #56, #57, #58, #59, #60, #61, #62.

## Goal

Ship Prelude's recruiter-to-candidate-to-review workflow through small vertical
slices that can each be refined, implemented, smoke-tested, reviewed, and
released independently.

The workflow is complete only when a recruiter can:

1. Sign in and resolve to an organization-owned workspace.
2. Complete onboarding and create or select a first job.
3. Build, edit, and publish an interview plan.
4. Share a stable candidate link.
5. Let a candidate complete a live interview.
6. Persist runtime events and transcript evidence.
7. Generate a persisted candidate brief from evidence.
8. Review the candidate from real persisted data in the console.
9. Re-run a local smoke that proves the complete path without paid LLM calls.

## Operating Model

Use one orchestrator issue to keep sequencing and one implementation issue per
vertical slice. The orchestrator is responsible for dependencies, scope control,
acceptance gates, and release notes. Feature teams own implementation details
inside their slice.

Each feature team should contain these review roles, even if a single engineer
implements the code:

- Product or HR reviewer: validates recruiter value, business wording, and
  candidate/recruiter expectations.
- Architecture reviewer: checks data ownership, service boundaries, auth scope,
  and provider/mocking strategy.
- Frontend reviewer: checks the user flow, responsive UI, loading/error states,
  and design-system consistency.
- Backend reviewer: checks persistence, validation, idempotency, and actions or
  API contracts.
- QA/data reviewer: checks smoke coverage, evidence quality, and edge cases.

## Slice Gates

### Definition of Ready

A slice is ready to implement when it has:

- A single user outcome and explicit non-goals.
- Input data, output data, and owner aggregate identified.
- Organization-scope and authorization behavior identified.
- Mock/live provider boundary identified.
- Acceptance criteria with at least one smoke or testable proof.
- Migration impact known, including whether existing local data can drift.

### Definition of Done

A slice can be merged when:

- Product UI uses persisted data for the core workflow, not unlabelled mocks.
- Console reads and writes are scoped to the active organization.
- Candidate-facing links resolve from published interview snapshots.
- Live or paid providers are opt-in and never required for default CI/local smoke.
- Validation commands pass for touched packages.
- The issue comment includes the commands run and the evidence produced.
- Follow-ups are filed instead of hidden in comments when they affect V1 scope.

## Current E2E Slice Status

| Slice                            | Issue | State  | Evidence                                                                                                     |
| -------------------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Domain spine                     | #54   | Closed | `docs/architecture/v1-domain-spine.md`, Prisma models, merged PR #66                                         |
| Workspace auth and org ownership | #55   | Open   | Clerk proxy, organization membership upsert, onboarding guard, org-scoped loaders/actions                    |
| Resumable onboarding             | #56   | Closed | Onboarding progress persistence, merged PR #67/#68                                                           |
| Job builder and publish          | #57   | Open   | Persisted draft/publish actions and policy checks exist; remaining hardening belongs in #57                  |
| Public candidate link            | #58   | Closed | Published public token candidate flow, merged PR #70                                                         |
| Event/transcript attachment      | #59   | Closed | Candidate session to live event evidence, merged PR #71                                                      |
| Live room polish                 | #37   | Open   | Real OpenAI/LiveKit mobile smoke evidence exists on #37; close when final product owner sign-off is recorded |
| Candidate brief generation       | #60   | Closed | Persisted `CandidateBrief` generation, merged PR #72                                                         |
| Recruiter real-data review       | #61   | Closed | Candidate detail/dashboard uses persisted data, merged PR #73                                                |
| Repeatable E2E smoke             | #62   | Closed | `make e2e-smoke`, merged PR #74                                                                              |
| Commercial POC checklist         | #23   | Open   | `docs/operations/live-ia-commercial-poc-checklist.md`; keep open until go/no-go owner signs off              |

## Dynamic Release Flow

Run this loop for every remaining slice:

1. Refine the issue with the five reviewer roles.
2. Confirm whether the slice is code, docs, test, UX polish, or issue cleanup.
3. Implement the smallest vertical change that moves the real workflow forward.
4. Run focused package validation.
5. Run `make e2e-smoke` when the slice touches persisted workflow data.
6. Comment the issue with evidence and known limitations.
7. Merge.
8. Re-audit open P0 issues before starting the next slice.

## Smoke Strategy

Default smoke must be repeatable and cheap:

```bash
make db-migrate
make e2e-smoke E2E_SMOKE_RUN_ID=local-v1
```

Live or paid provider smoke must be explicit:

```bash
ALLOW_LIVE_LLM_TESTS=1 make e2e-smoke-live E2E_SMOKE_RUN_ID=local-v1-live
```

Live interview quality still uses the realtime report:

```bash
make live-smoke-report SESSION_ID=is_xxx
```

Do not run paid provider smoke in CI by default. Use CI for deterministic tests
and local/demo environments for explicit live-provider checks.

## Remaining Release Risks

- #55 still needs targeted tests for unauthenticated users, incomplete
  onboarding, and wrong-organization access.
- #57 still owns hardening around job metadata, publish/versioning semantics,
  and compliance-copy gating.
- #63 is the next product workflow slice after core E2E: human notes and review
  status controls.
- #64 is required before a serious commercial pilot: visible candidate trust and
  policy guardrail copy.
- #65 can remain P2 until the core workflow is stable.
