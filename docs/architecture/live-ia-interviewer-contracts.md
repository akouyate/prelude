# Live IA Interviewer Contracts

## Contract Principles

- Go owns durable session state.
- Python emits normalized events to Go; Python does not write directly to the database.
- LiveKit transports media and data but is not the business event source of truth.
- Provider payloads are stored only as optional metadata behind normalized contracts.
- Every event is append-only and idempotent.
- Contract and business-rule changes are test-first: add or update focused tests before changing the Go/Python implementation.

The TypeScript Zod schemas in `packages/contracts/src/schemas/live-interview.ts` are the POC contract reference for Next.js and for generating equivalent Go/Python structs later.

For the current Go/Python POC wire API, JSON fields are serialized in `snake_case` to match Go and Python conventions. The TypeScript contracts use idiomatic `camelCase` for frontend DTOs. A later API hardening pass should either generate both shapes from one schema or add explicit mappers at the boundary.

## Core Objects

### Interview Plan

An `InterviewPlan` is the approved script the IA interviewer must follow.

Required fields:

- `planId`
- `jobId`
- `roleTitle`
- `locale`
- `candidateModes`
- `questions`

The POC should keep the plan short: 5 to 8 questions, one optional follow-up per question.

### Session

A `LiveInterviewSession` represents one candidate attempt.

The Go API owns:

- `sessionId`
- `candidateId`
- `planId`
- `status`
- `livekitRoomName`
- `createdAt`
- `updatedAt`

### Transcript Turn

A `TranscriptTurn` is a normalized speaking turn from the candidate or IA interviewer.

The Go API should persist final transcript turns. Interim transcripts can be streamed to the UI but should not be treated as durable truth.

For the POC, candidate transcript turns are carried by `candidate_turn_finalized`. Interviewer prompts are carried by `question_asked` and `followup_asked`.

## Event Envelope

Every event sent from Python to Go uses the same envelope:

```json
{
  "event_id": "evt_01",
  "session_id": "session_01",
  "type": "question_asked",
  "actor": "agent",
  "sequence": 12,
  "idempotency_key": "session_01:question_asked:q_01:1",
  "occurred_at": "2026-06-17T10:30:00.000Z",
  "payload": {}
}
```

Rules:

- `eventId` is unique.
- `actor` is required and identifies the emitter as `agent`, `candidate`, or `system`.
- `sequence` is monotonic per session from the producer perspective.
- `idempotencyKey` must be stable for retries.
- `occurredAt` is provider/runtime time in ISO 8601.
- Go stores events append-only and ignores duplicated idempotency keys.
- Tests should cover event acceptance, duplicated idempotency behavior in the Go event store, and rejection of malformed discriminated payloads.

## Event Types

### `session_started`

Emitted when the agent has enough context to start the interview.

Payload:

- `provider`
- `agentParticipantId`

### `candidate_joined`

Emitted when the candidate joins the LiveKit room.

Payload:

- `candidateParticipantId`
- `modes`

### `agent_joined`

Emitted when the IA interviewer joins the LiveKit room.

Payload:

- `agentParticipantId`
- `provider`

### `agent_speech_started`

Emitted when the agent is allowed to start an utterance.

Expected actor: `agent`

Payload:

- `questionId` optional
- `utteranceId`
- `utteranceKind`: `intro`, `question`, `repeat`, `soft_reprompt`,
  `followup`, or `closing`

### `agent_speech_completed`

Emitted when the agent utterance has completed without interruption.

Expected actor: `agent`

Payload:

- `questionId` optional
- `utteranceId`
- `utteranceKind`
- `audioDurationMs` optional

### `agent_speech_interrupted`

Emitted when the active agent utterance is canceled or truncated after an
accepted candidate barge-in.

Expected actor: `system`

Payload:

- `utteranceId`
- `questionId` optional
- `cancelLatencyMs`
- `truncatedAtMs` optional
- `cancelAgentAudio`: `true`

### `question_asked`

Emitted after the IA starts or finishes asking a planned question.

Payload:

- `questionId`
- `questionIndex`
- `prompt`

### `question_repeated`

Emitted when the candidate asks the IA to repeat the current question.

Payload:

- `questionId`
- `prompt`
- `reason`: `candidate_requested_repeat`

### `candidate_speech_started`

Emitted when candidate speech starts.

Expected actor: `candidate`

Payload:

- `questionId` optional
- `turnId` optional
- `trackId` optional
- `confidence` optional

### `candidate_speech_stopped`

Emitted when candidate speech stops.

Expected actor: `candidate`

Payload:

- `questionId` optional
- `turnId` optional
- `speechDurationMs` optional

### `candidate_turn_detected`

Emitted when the runtime believes the candidate turn is ready to finalize. This
is a turn-taking signal; `candidate_turn_finalized` remains the durable
transcript event.

Expected actor: `system`

Payload:

- `questionId`
- `semanticComplete` optional
- `stableSilenceMs` optional
- `confidence` optional

### `candidate_turn_started`

Emitted when the structured candidate answer attempt starts for the current
question. Low-level speech onset is carried by `candidate_speech_started`.

Payload:

- `questionId` optional

### `candidate_turn_finalized`

Emitted when a candidate answer transcript is final.

Payload:

- `questionId`
- `completionReason`: `answered`, `skipped`, or `incomplete`
- `transcriptTurn`

### `barge_in_detected`

Emitted when candidate speech overlaps an active agent utterance.

Expected actor: `candidate`

Payload:

- `utteranceId`
- `questionId` optional
- `overlapMs` optional
- `candidateSpeechMs` optional
- `confidence` optional

### `barge_in_accepted`

Emitted when policy classifies an overlap as a true interruption.

Expected actor: `system`

Payload:

- `utteranceId`
- `questionId` optional
- `cancelLatencyMs`
- `truncatedAtMs` optional

### `barge_in_rejected`

Emitted when policy rejects an overlap as a false interruption.

Expected actor: `system`

Payload:

- `utteranceId` optional
- `questionId` optional
- `reason`: `backchannel`, `noise`, `too_short`, or `low_confidence`
- `observedSpeechMs` optional

### `backchannel_detected`

Emitted when a false barge-in is classified as a backchannel such as "mm-hmm"
or "yes".

Expected actor: `system`

Payload:

- `utteranceId` optional
- `questionId` optional
- `reason`: `backchannel`
- `observedSpeechMs` optional

### `silence_timeout_started`

Emitted when a silence threshold is reached and policy starts the next silence
tier. Despite the name, this is a durable "threshold reached" event, not an
internal timer-start event.

Expected actor: `system`

Payload:

- `questionId` optional
- `thresholdMs`
- `silentForMs` optional
- `tier`: `soft_prompt`, `wait_extension`, or `terminal`

### `wait_requested`

Emitted when the candidate asks for more time.

Expected actor: `candidate`

Payload:

- `questionId` optional
- `requestedAt` optional
- `waitUntil` optional
- `reason`: `candidate_requested_time`

### `soft_reprompted`

Emitted when the candidate answer is incomplete, unclear, or silent and the IA
uses its single recovery prompt for that question.

Payload:

- `questionId`
- `prompt`
- `repromptsUsed`

### `followup_asked`

Emitted when the IA asks its single allowed follow-up.

Payload:

- `questionId`
- `followupId`
- `prompt`

### `question_completed`

Emitted when the agent considers a planned question complete.

Payload:

- `questionId`
- `completionReason`

### `session_completed`

Emitted when the interview is complete.

Payload:

- `completedReason`

### `session_closing`

Emitted when all planned questions are done and the IA is about to close the
interview.

Payload:

- `completedQuestions`
- `closing`

### `session_failed`

Emitted for unrecoverable runtime failure.

Payload:

- `code`
- `message`
- `retryable`

## API Surface For The POC

The implemented POC service currently exposes the shorter `/v1/interview-sessions` prefix. The `/v1/live-interviews/sessions` shape remains a product-facing naming candidate for a later API cleanup, not the current wire contract.

### `POST /v1/interview-sessions`

Creates a session and prepares the LiveKit room.

Input:

- `interview_plan_id`
- `candidate_id`
- `allowed_modalities`

Output:

- `session`
- `status`
- `livekit_join`

### `GET /v1/interview-sessions/:sessionId`

Returns the current session and appended events.

Output:

- `session`

### `GET /v1/interview-sessions/:sessionId/agent-config`

Called by the Python worker before joining the LiveKit room.

Output:

- `session`
- `livekit_join`: room URL, room name, short-lived agent token, participant id
- `interview_plan`: mocked POC plan until generated plans are persisted
- `provider`: `mock` for the local POC, then `openai_realtime`

### `POST /v1/interview-sessions/:sessionId/events`

Called by the Python worker to append normalized events.

Input:

- `LiveInterviewEvent`
- `actor` is required and must identify the emitter.

Output:

- `accepted`
- `duplicate`

## Failure Modes

The system should emit `session_failed` and expose a candidate-safe fallback for:

- mic permission denied
- camera required but denied
- agent failed to join
- provider timeout
- LiveKit disconnect
- transcript unavailable

Candidate-safe copy should avoid technical provider names. Recruiter/admin logs can include provider metadata.

## Versioning

Keep POC contracts under one package version. Add explicit event versions only when an incompatible event payload change is needed.

Recommended future envelope field:

- `schemaVersion: "2026-06-17"`

Do not add it until two independent consumers need compatibility support.
