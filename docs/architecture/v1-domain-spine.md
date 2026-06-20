# Prelude V1 Domain Spine

Issue: [#54](https://github.com/akouyate/prelude/issues/54)

## Canonical Model

The V1 product workflow is centered on persisted recruiter and candidate data:

```text
Organization
  -> User / OrganizationMembership
  -> Job
  -> InterviewDraft
  -> Interview
  -> CandidateSession
  -> LiveInterviewSession / LiveInterviewEvent
  -> CandidateBrief
  -> Recruiter review
```

`CandidateSession` is the durable product aggregate for a candidate result.
Recruiter pages should start from `CandidateSession` when reviewing a candidate.

`LiveInterviewSession` is runtime evidence from the realtime service. It is
linked through `CandidateSession.realtimeSessionId`, but it is not the primary
product record because realtime rooms can fail, be retried, or be managed by a
separate service.

## Entity Responsibilities

### Organization

Owns all recruiter data. Console reads and writes must be scoped by
`organizationId`.

### User / OrganizationMembership

Connects a Clerk user to an organization and role. V1 roles are:

- `owner`
- `admin`
- `recruiter`
- `viewer`

The full permission matrix is refined in #55.

### Job

The recruiter business object. A job can have editable interview drafts,
published interviews, and candidate sessions.

### InterviewDraft

Editable recruiter workspace for questions, criteria, response modes,
guardrails, and rationale.

### Interview

Published interview plan snapshot. Candidate links resolve to this object, not
to the editable draft. It preserves what the candidate was asked to answer.

### CandidateSession

Durable candidate result aggregate. It links directly to:

- `Organization`
- `Job`
- `Interview`
- optional `realtimeSessionId`
- optional `CandidateBrief`

It stores candidate identity when available, product status, started/completed
timestamps, and the human-owned `reviewStatus`.

### LiveInterviewSession / LiveInterviewEvent

Append-only runtime evidence for live interview state, transcript turns, answer
evaluations, recovery prompts, and provider metadata.

The database does not enforce a foreign key from `CandidateSession` to
`LiveInterviewSession`. A previous migration intentionally removed that
constraint because realtime sessions may be written by a separate service.

### CandidateBrief

Persisted IA synthesis generated after live completion. It is versionable and
statused independently from the live session:

- `pending`
- `processing`
- `completed`
- `failed`

The brief must be evidence-based. If transcript or answer evidence is missing,
the output must expose limitations or `Not assessable` states instead of
inventing a confident summary.

### Recruiter Review

Human-owned review state on `CandidateSession.reviewStatus`:

- `to_review`
- `to_call`
- `archived`

This is not an IA decision. It supports the recruiter workflow and remains
separate from the generated brief.

## Product Constraints

- Product UI must not require `demo-token` or mock candidate results for the
  core workflow.
- Mock data can exist only in tests, dev seed/smoke commands, or clearly marked
  demo routes.
- IA analysis must not generate global numeric fit scores, rankings, automatic
  rejection, or hiring decisions.
- Claims in `CandidateBrief` must be grounded in transcript/live event evidence
  or explicitly marked as not assessable.

## Implemented In #54

- `CandidateSession.jobId` for direct job-to-result queries.
- `CandidateSession.reviewStatus` for the human review state.
- `CandidateBrief` model for persisted post-live synthesis.
- Shared status constants in `@prelude/types`.
- Console helper for org-scoped candidate-session spine loading.
- Dashboard/detail status resolution can prefer persisted `CandidateBrief`
  status over live event fallback.

## Explicitly Deferred

- #55 owns Clerk organization ownership and the full permission matrix.
- #56 owns resumable onboarding persistence.
- #57 owns publish/versioning hardening for live interview plans.
- #58 owns replacing candidate demo fallback with real public candidate links.
- #59 owns transcript/event attachment completeness.
- #60 owns the IA synthesis job that writes `CandidateBrief`.
- #61 owns the full real-data recruiter review UX.
