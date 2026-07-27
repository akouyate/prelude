# Current ship state

## Goal

Upgrade Prelude's live interviewer to LiveKit Agents 1.6.7 and replace the
home-grown turn/interruption handling where LiveKit now provides a better
supported primitive.

## Scope

- Pin the Python voice runtime and migrate to LiveKit Turn Detector and adaptive
  interruption handling behind an explicit configuration boundary.
- Preserve OpenAI Realtime for the interviewer voice and reasoning path.
- Make mobile/browser disconnects recoverable instead of failing the interview
  immediately.
- Deprecate superseded turn-taking code and keep one production behavior path.
- Add latency, fallback, interruption and reconnect observability.
- Cover long pauses, genuine interruptions, backchannels, silence, reconnects
  and closing playout with deterministic tests.

## Workflow

- [x] Intake, repository investigation and LiveKit documentation research
- [x] Initial architecture and behavior audit
- [x] Pin runtime and migrate LiveKit turn handling
- [x] Implement reconnect-safe session lifecycle
- [x] Deprecate superseded behavior and consolidate orchestration
- [x] Add metrics and regression scenarios
- [x] Review, simplify and validate

## Decisions

- Prefer official LiveKit turn detection and adaptive interruption primitives
  over Prelude's snapshot-based overlap heuristic when the runtime supports
  them.
- Keep business question sequencing and evidence evaluation in Prelude.
- Do not add synthetic verbal backchannels until interruption and endpointing
  behavior is reliable and measured.
- Preserve existing unrelated worktree changes.
- Roll out new turn handling behind configuration so the current behavior
  remains available during live comparison.
- Use a separate aligned STT stream for Prelude's complete-turn business hook.
- Use deterministic TTS only for contractual lines such as checkout; keep
  OpenAI Realtime as the conversational voice.
- Use GPT-5.4 nano for bounded live answer classification, with Prelude's
  deterministic matrix guardrails and heuristic fallback.

## Validation target

- All existing Python, Go and candidate tests remain green.
- The Python suite passes against the pinned LiveKit Agents version.
- Candidate disconnects have a bounded resume window and do not immediately
  fail the product session.
- Tests cover false and genuine interruptions, backchannels, multi-second
  thinking pauses, silence after every question, reconnect and final closing.
- Runtime metrics make fallback and latency regressions observable.

## Validation result

- Python interviewer-agent: 196 tests passed.
- Go realtime service: all packages passed.
- Candidate app: 78 tests passed; typecheck and lint passed.
- Connected LiveKit Cloud/OpenAI smoke: 3/3 questions completed, 3/3
  `llm_assisted` evaluations, exact checkout playout, contiguous events, and no
  strict-report anomalies (`is_c6e304f80af239f3389b27ea`).
