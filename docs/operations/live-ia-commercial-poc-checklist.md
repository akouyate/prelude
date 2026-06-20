# Live IA Commercial POC Checklist

Issue: #23

## Purpose

This checklist defines when the live IA interviewer is strong enough to demo to
early recruiters or use in a bounded commercial pilot.

The POC is a first-screening workflow. Prelude helps recruiters collect
structured evidence faster, but it does not rank candidates or make hiring
decisions.

## Go/No-Go Summary

The POC is demo-ready only when all of these are true:

- A recruiter can create and publish a real interview plan from the console.
- A candidate can complete a 4 to 7 minute audio-first interview without help.
- The IA asks the planned questions, uses at most one follow-up per question,
  and handles repeat, wait, silence, and clarification requests without losing
  the active question.
- Transcript evidence and runtime events are persisted.
- A recruiter can open a real candidate detail page and inspect transcript
  evidence plus the persisted IA brief.
- The UI clearly states that the IA does not make final hiring decisions.
- The default smoke path is deterministic and does not call paid LLM providers.
- Any live provider smoke is explicitly opted in.

## Candidate Success Criteria

- Candidate understands they are speaking with an IA interviewer.
- Candidate can grant microphone permissions and start from desktop or mobile.
- Candidate can ask to repeat, ask for context, wait briefly, or recover from
  silence.
- The IA does not intentionally cut the candidate off.
- The candidate receives a clear closing message before the session completes.
- Candidate-facing copy avoids provider names, raw tokens, and implementation
  language.

## Recruiter Success Criteria

- Recruiter can configure the interview from job context.
- Recruiter can approve questions, criteria, guardrails, and response modes
  before publish.
- Recruiter receives a structured candidate brief after completion.
- Recruiter can inspect evidence by transcript or question/answer.
- Recruiter can see limitations, missing data, and not-assessable criteria.
- Recruiter understands that Prelude supports human review only.

## Technical Success Criteria

- Real OpenAI/LiveKit smoke can complete on desktop and mobile Chrome.
- Readiness gate proves candidate joined and media was ready before first
  interviewer question.
- Transcript contains interviewer turns and candidate turns when final
  transcription callbacks are emitted.
- Runtime event sequence is contiguous.
- Provider failures, mic denial, reconnect, timeout, and silence are recoverable
  or clearly reported.
- Cost per completed interview can be estimated from provider and duration data.

## Demo Script

1. Open the authenticated console.
2. Confirm the organization is onboarded.
3. Open or create a job.
4. Generate or edit the interview draft.
5. Review questions, criteria, response modes, and guardrails.
6. Publish the interview and copy the candidate link.
7. Open the candidate link on desktop or mobile.
8. Start the interview, grant microphone permissions, and answer naturally.
9. Ask for one repeat or clarification during the interview.
10. Complete the session and wait for the closing message.
11. Open the recruiter interview detail page.
12. Confirm persisted status, transcript evidence, IA brief, limitations, and
    non-decision copy.
13. Run or attach the smoke report.

## Evidence To Capture

For every live demo rehearsal, capture:

- Date and environment.
- Browser and device.
- Realtime session id.
- Candidate session id.
- Interview id and candidate link.
- LiveKit/OpenAI mode.
- Event count.
- Transcript turn count.
- Question completion rate.
- Provider errors or warnings.
- Candidate experience notes.
- Recruiter review notes.
- Decision: pass, retry needed, or blocker.

## Default Local Proof

Use the deterministic V1 smoke for release confidence:

```bash
make db-migrate
make e2e-smoke E2E_SMOKE_RUN_ID=local-v1
```

Use live provider smoke only with explicit opt-in:

```bash
ALLOW_LIVE_LLM_TESTS=1 make e2e-smoke-live E2E_SMOKE_RUN_ID=local-v1-live
```

For a completed live room session, generate the replayability report:

```bash
make live-smoke-report SESSION_ID=is_xxx
```

## Known Risks

- The candidate may over-trust the IA unless disclosure and non-decision copy
  stay visible.
- Recruiters may over-interpret synthesis unless limitations are prominent.
- Live provider latency can make the interview feel less natural.
- Mobile browser permission and autoplay behavior can regress.
- Transcript quality can affect analysis quality.
- Costs can drift if live smoke is accidentally run in CI or broad QA loops.

## Non-Goals

- No automatic hiring or rejection decision.
- No global candidate score or ranking.
- No appearance, emotion, accent, age, gender, origin, disability, health,
  family status, religion, or other protected-trait analysis.
- No full ATS workflow.
- No unbounded conversational interview.
- No paid provider calls in default CI/local smoke.

## Current Decision

Core E2E workflow is ready for internal demo rehearsal when `make e2e-smoke`
passes and live-room smoke evidence is available.

Commercial pilot readiness still requires final sign-off on:

- #20 compliance and candidate trust guardrails.
- #21 recruiter insight review surface.
