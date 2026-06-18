# Live IA Provider Benchmark

Issue: #19

## Purpose

Choose the provider strategy for Prelude's live IA first-screen interviewer by
running the same interview scenarios against OpenAI Realtime and ElevenLabs.

The benchmark must measure live-interview fitness, not generic chatbot quality:
latency, turn-taking, interruption handling, transcript quality, recruiter tone,
operational complexity, and estimated cost per completed interview.

## Current Implementation

The Python interviewer service now includes a repeatable benchmark harness:

```bash
cd services/interviewer-agent
python -m app.benchmark_cli \
  --provider mock_openai_realtime \
  --scenario normal \
  --iterations 3 \
  --benchmark-run-id local-smoke
```

The harness:

- Reuses the existing `InterviewSessionRunner`.
- Runs deterministic scenarios from the same demo interview plan.
- Emits normalized events with `benchmark_run_id`, provider, scenario, and
  iteration in `provider_metadata`.
- Can persist events through the Go Realtime API with `--realtime-api-url`.
- Produces JSON reports with run status, event counts, and initial metrics.
- Blocks real provider runs with explicit missing environment variables when
  credentials are not configured.

## Provider Access Needed

Shared:

- LiveKit Cloud or local LiveKit server.
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- Go Realtime API reachable through `REALTIME_API_URL`.
- Postgres running for durable event evidence.

OpenAI Realtime:

- `OPENAI_API_KEY`
- `OPENAI_REALTIME_MODEL`
- Billing or credits enabled.

ElevenLabs:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_ID`
- `ELEVENLABS_VOICE_ID`
- Billing or credits enabled.

## Scenarios

Run each provider against the same scenarios:

| Scenario | Purpose |
| --- | --- |
| `normal` | Baseline direct answers. |
| `interrupt` | Candidate barge-in while the IA interviewer is speaking. |
| `repeat` | Candidate asks the interviewer to repeat a question. |
| `silence` | Candidate is initially silent and recovers after a soft prompt. |
| `vague` | Candidate gives a vague answer requiring one controlled follow-up. |
| `noise` | Initial background noise before a usable answer. |
| `audio_only` | Candidate completes without video. |
| `video_enabled` | Candidate joins with video, but scoring remains content-only. |

## Metrics

Objective metrics to collect:

- Session setup time.
- Time to first interviewer audio.
- Candidate speech start detection latency.
- Candidate speech stop to next IA response latency.
- Interruption cancel latency.
- False interruption and backchannel count.
- Silence timeout accuracy.
- Transcript quality.
- Completed questions.
- Provider errors, reconnects, and timeouts.
- Event persistence completeness.
- Cost estimate per 5-minute interview.

Subjective scoring should remain separate and use a 1-5 rubric:

- Voice naturalness.
- Recruiter-like tone.
- Candidate comfort.
- Politeness and professionalism.
- Perceived responsiveness.
- Ability to respect the interview plan.
- Ability to avoid free chat and forbidden topics.
- Implementation and debugging ease.

## Decision Rules

Use this first scorecard for provider recommendation:

| Area | Weight |
| --- | ---: |
| Turn-taking and interruption handling | 30% |
| Latency and perceived responsiveness | 20% |
| Transcript quality | 15% |
| Voice quality and candidate comfort | 15% |
| Control, observability, and debugging | 10% |
| Cost and reliability | 10% |

Initial go/no-go thresholds:

- Event completeness: 100% of expected normalized events for completed runs.
- No free-chat, forbidden-topic, or extra-question violations.
- Candidate barge-in cancel latency target: p95 below 300 ms.
- End-of-speech to next IA response target: p95 below 1200 ms.
- False barge-in rate target: below 5% on critical scenarios.
- Cost per 5-minute interview below the commercial ceiling to define.

OpenAI Realtime should remain the primary POC candidate if it provides:

- Better state and tool-control alignment with Prelude's Python runtime.
- Reliable interruption cancellation and transcript reconstruction.
- Acceptable French recruiter voice quality.
- Predictable cost and debugging metadata.

ElevenLabs should become the preferred voice path if it materially improves:

- Naturalness and candidate comfort.
- End-to-end voice latency.
- Professional French voice quality.

But ElevenLabs should not own business state unless it can preserve:

- Prelude's one-question-at-a-time rule.
- One controlled follow-up per planned question.
- Provider-neutral event emission.
- No protected-trait or video-derived scoring.

## Initial Recommendation

Use the mock harness to validate event persistence and scenario repeatability
locally. Once credentials are available, run at least three iterations per
provider/scenario pair and compare persisted reports before choosing the
commercial POC provider.

Do not choose a provider from subjective voice quality alone.

## Sources

- https://docs.livekit.io/agents/
- https://docs.livekit.io/agents/models/realtime/plugins/openai/
- https://developers.openai.com/api/docs/guides/realtime
- https://developers.openai.com/api/docs/guides/realtime-webrtc
- https://elevenlabs.io/docs/eleven-agents/overview
- https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets
