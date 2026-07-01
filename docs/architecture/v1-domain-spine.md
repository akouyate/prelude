# Prelude V1 Domain Spine

Issues:

- [#54](https://github.com/akouyate/prelude/issues/54) introduced the domain
  spine.
- [#110](https://github.com/akouyate/prelude/issues/110) hardens the V1
  candidate lifecycle and business rules.

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

`CandidateInvitation` is the public candidate entry point. New published
interviews create an invitation token (`ci_...`) for the candidate URL; legacy
`Interview.publicToken` URLs remain accepted as a compatibility fallback only.

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

Published interview plan snapshot. Candidate invitations resolve to this object,
not to the editable draft. It preserves what the candidate was asked to answer.

### CandidateInvitation

Public invitation token for a candidate attempt. It stores the invitation token,
expiration, opened/consented audit fields, and the current high-level lifecycle
status for that invite.

`CandidateInvitation` owns the one-active-attempt invariant: the database has a
partial unique index that prevents multiple active `CandidateSession` rows for
the same invitation. Failed and abandoned attempts can be retried by creating a
fresh attempt for the same invitation; completed, expired, and superseded
invitations cannot be started again.

### CandidateSession

Durable candidate result aggregate. It links directly to:

- `Organization`
- `Job`
- `Interview`
- optional `CandidateInvitation`
- optional `realtimeSessionId`
- optional `CandidateBrief`

It stores candidate identity when available, product status, started/completed
timestamps, and the human-owned `reviewStatus`.

For V1, the product lifecycle is represented in
`@prelude/core/src/domain/candidate-lifecycle.ts`. The canonical statuses are:

- `invited`: candidate link exists, interview not opened yet.
- `opened`: candidate loaded the public interview page.
- `consent_required`: required consent is missing or outdated.
- `ready`: consent is accepted and the candidate can start.
- `starting`: room/session is being prepared or waiting for candidate/agent join.
- `in_progress`: interview is active.
- `reconnecting`: temporary network, LiveKit, mic, or agent reconnect.
- `completed`: valid terminal completion after final answer and checkout.
- `abandoned`: candidate left or became inactive before completion.
- `failed`: technical/provider failure prevents a reliable interview.
- `expired`: candidate link/session is no longer usable.
- `superseded`: attempt was replaced by a newer valid attempt.

Legacy runtime/product values are normalized before display or policy checks:
`created -> invited`, `started -> starting`, `waiting_candidate -> starting`,
`agent_joining -> starting`, and `paused -> reconnecting`.

Completed, expired, and superseded attempts are terminal. Failed and abandoned
attempts can be retried only through the explicit retry policy, which creates a
fresh attempt and marks the old one `superseded`.

V1 response modes are audio-first with a quiet form fallback. The product must
not expose video as a candidate-facing option in V1, and legacy stored `video`
entries are filtered before public candidate use.

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
- `partial`
- `insufficient_signal`
- `technical_failure`
- `failed`

`completed` means the interview completed and there is enough reviewable,
job-related candidate evidence for a recruiter brief. `partial`,
`insufficient_signal`, and `technical_failure` are deliberately not full
candidate briefs. They preserve useful context while making it clear that the
result must not be treated like a completed screen.

The brief must be evidence-based. If transcript or answer evidence is missing,
the output must expose limitations or `Not assessable` states instead of
inventing a confident summary. Technical failures must never be interpreted as
candidate weakness.

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
- Candidate-facing V1 UI is audio-first. Form fallback can be offered where the
  published plan supports text/form responses. Video is not a selectable V1
  mode.
- IA analysis must not generate global numeric fit scores, rankings, automatic
  rejection, or hiring decisions.
- Claims in `CandidateBrief` must be grounded in transcript/live event evidence
  or explicitly marked as not assessable.
- A candidate brief is for human review only. It must never analyze protected
  traits, appearance, accent, tone, emotion, personality, or biometric signals.

## Implemented In #54

- `CandidateSession.jobId` for direct job-to-result queries.
- `CandidateSession.reviewStatus` for the human review state.
- `CandidateBrief` model for persisted post-live synthesis.
- Shared status constants in `@prelude/types`.
- Console helper for org-scoped candidate-session spine loading.
- Dashboard/detail status resolution can prefer persisted `CandidateBrief`
  status over live event fallback.

## Implemented In #110

- Shared candidate lifecycle policy in `@prelude/core`, including allowed
  transitions, legacy normalization, consent gates, terminal states, and
  retry/resume policy.
- Candidate start, completion, abandon, and failure endpoints use lifecycle
  status checks instead of loose string mutation.
- Duplicate completion is idempotent; failed and abandoned attempts create a
  fresh retry attempt and supersede the older attempt only after realtime
  preparation succeeds.
- `CandidateInvitation` stores public candidate tokens, invitation expiry,
  opened/consented audit data, and prevents multiple active attempts for the same
  invite.
- New published interviews return an invitation token in `candidatePath`; console
  views prefer an active invitation token and keep `Interview.publicToken` only
  as a legacy fallback.
- Public candidate UI no longer exposes video. It requests microphone access
  only and maps lifecycle API errors to candidate-specific copy for expired,
  superseded, completed, not-resumable, and unavailable states.
- Form fallback is available only when the published plan includes text/form. It
  creates a completed `CandidateSession`, stores a completed
  `LiveInterviewSession`, and writes transcript-like `LiveInterviewEvent`
  evidence with `source: form_fallback`.
- Candidate brief generation distinguishes `completed`, `partial`,
  `insufficient_signal`, and `technical_failure` outputs, so partial or failed
  sessions are not displayed as full screens.
- Local V1 E2E smoke seeds `CandidateInvitation` and prints a `ci_...`
  candidate URL; the candidate Playwright smoke runs on mobile with microphone
  only and covers both audio start and microphone-denied form fallback.

## Explicitly Deferred

- #55 owns Clerk organization ownership and the full permission matrix.
- #56 owns resumable onboarding persistence.
- #57 owns publish/versioning hardening for live interview plans.
- Candidate notification delivery, named invite creation UI, and channel-specific
  email/calendar messaging remain separate V1 workflow tickets.
- #59 owns transcript/event attachment completeness.
- #60 owns the IA synthesis job that writes `CandidateBrief`.
- #61 owns the full real-data recruiter review UX.
