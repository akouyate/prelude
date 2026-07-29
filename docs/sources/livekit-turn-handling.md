# LiveKit turn handling

Reviewed on 2026-07-27 for the HireCall live interviewer.

## Primary sources

- [LiveKit Agents 1.6.7 release](https://github.com/livekit/agents/releases/tag/livekit-agents%401.6.7)
  adds adaptive interruption handling for realtime models.
- [Adaptive interruption handling](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/)
  defines backchannel filtering, false-interruption recovery, and supported
  turn-handling options.
- [Turn Detector](https://docs.livekit.io/agents/logic/turns/turn-detector/)
  describes the audio-aware end-of-turn detector and the local `v1-mini`
  deployment option.
- [LiveKit Inference STT](https://docs.livekit.io/agents/models/stt/)
  documents the aligned Deepgram Nova-3 stream used to deliver the complete
  candidate transcript to `Agent.on_user_turn_completed`.
- [Turn handling options](https://docs.livekit.io/reference/agents/turn-handling-options/)
  documents endpointing, interruption, preemptive generation, and user-turn
  limits.
- [Agent session: handling inactive users](https://docs.livekit.io/agents/logic/sessions/#handling-inactive-users)
  defines `user_away_timeout`, the `away` user state, cancellable check-ins,
  and session shutdown after repeated unanswered prompts.
- [OpenAI Realtime turn detection](https://platform.openai.com/docs/api-reference/realtime)
  documents `idle_timeout_ms` as a `server_vad`-only feature. HireCall uses
  LiveKit's turn detector and therefore keeps business inactivity outside the
  OpenAI conversation model.
- [Reconnect semantics](https://livekit.com/blog/keep-your-agent-in-the-room-on-reconnect)
  recommends keeping the agent in the room across transient participant
  disconnects and bounding the room departure window.
- [LiveKit data hooks](https://docs.livekit.io/deploy/observability/data/)
  defines `ChatMessage.metrics` as the per-turn latency source and
  `session_usage_updated` as the supported live usage source. The previous
  session-level `metrics_collected` event is deprecated.
- [LiveKit text and transcriptions](https://docs.livekit.io/agents/multimodality/text/)
  defines `lk.transcription` text streams as the supported frontend transport.
  Agent output is synchronized to audio playback and truncated on interruption.
- [OpenAI GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
  replaces HireCall's deprecated `gpt-realtime` baseline. OpenAI documents better
  silence, noise, interruption behavior, and configurable reasoning effort.
- [OpenAI GPT-Live announcement](https://openai.com/index/introducing-gpt-live/)
  describes the continuous full-duplex voice system now used by ChatGPT. As of
  this review, OpenAI says API availability is forthcoming, so HireCall must not
  depend on it yet.

## HireCall boundary

LiveKit owns acoustic/session concerns: VAD, end-of-turn detection, endpointing,
backchannels, interruption classification, false-interruption recovery, and
transport reconnection.

HireCall owns business concerns: question order, recruiter-defined signals,
answer evaluation, follow-up limits, consent, persistence, closing, and audit.

The audio turn detector itself does not require STT with a realtime model.
HireCall does: its business policy must receive the complete candidate text before
choosing the next action. Official mode therefore uses one LiveKit Inference STT
stream and disables OpenAI Realtime input transcription to avoid duplicate and
late transcript sources.

HireCall raises LiveKit's endpointing floor to one second, with a five-second
ceiling. This is intentionally more patient than the general-purpose default:
screening answers routinely contain short pauses between context, action, and
result, and the interviewer must not advance while the candidate is still talking.

The final answer has a three-second silent grace before checkout, measured from
the start of answer inference so the two waits do not stack.
This is a HireCall business safeguard rather than a second endpointing system:
LiveKit still commits the turn, but any resumed candidate speech invalidates the
in-flight verdict. HireCall retains the fragment, merges it with the next committed
turn, and evaluates the combined answer before it can close the session.

The legacy `TurnTakingPolicy` and `InterviewerStateMachine` remain simulation
fixtures only. They must not be reintroduced into the production LiveKit worker.

## Connected-candidate inactivity

LiveKit's `user_state_changed -> away` transition is the sole connected-silence
sensor. HireCall applies a deterministic policy after that signal:

1. LiveKit marks the candidate away after 15 seconds while both sides are idle.
2. HireCall speaks one supportive check-in.
3. After 20 additional seconds, HireCall warns that the attempt will close in
   20 seconds and exposes a synchronized candidate countdown.
4. With no voice or explicit presence confirmation, HireCall speaks a closing
   line, persists `candidate_inactivity_timeout` as retryable, and disconnects.

Any resumed voice or reliable `candidate_presence_confirmed` room control
cancels the sequence and emits `silence_recovered`. A candidate request for time
replaces the normal threshold with a 60-second extension. These transitions are
never sent through answer inference: silence creates no transcript turn, score,
answer evaluation, or recruiter signal.

## Voice and candidate captions

HireCall uses `gpt-realtime-2.1` with low reasoning effort for conversational
speech. The `marin` voice and explicit delivery instructions form the production
baseline; voice changes require a human A/B test in French before rollout.

The candidate room consumes the official `lk.transcription` stream for
audio-synchronized interviewer captions. It renders one active utterance only.
Finalized history remains persisted for recruiter review but is intentionally
absent from the candidate's live stage, where stacked questions compete with the
current prompt and make streaming captions appear delayed.
