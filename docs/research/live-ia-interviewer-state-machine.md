# Live IA Interviewer State Machine Research

Issue: #16

## Why this matters

The live IA interviewer must behave like a short structured screening interview,
not like an open chatbot. The product risk is not only technical latency; it is
candidate trust, hiring fairness, and recruiter confidence in comparable
candidate signals.

## Research Inputs

- McDaniel et al., "The Validity of Employment Interviews" meta-analysis:
  structured interviews show higher validity than unstructured interviews for
  job performance prediction.
- Campion et al., "Structuring Employment Interviews to Improve Reliability,
  Validity, and Users' Reactions": structure improves reliability and user
  reactions when questions, probes, and scoring are controlled.
- U.S. OPM structured interview guidance: higher interview structure improves
  validity, rater reliability, agreement, and adverse impact; strong structure
  uses predefined lead and probe questions scored against benchmarks.
- Jurafsky & Martin, "Chatbots & Dialogue Systems": task-oriented dialogue
  systems need explicit dialogue state tracking rather than only generated
  responses.
- Gabsdil, "Clarification in Spoken Dialogue Systems": clarification should be
  targeted to the unclear part of the answer instead of treating the whole turn
  as failure.
- Jokinen, "The Need for Grounding in LLM-based Dialogue Systems": LLM dialogue
  should be grounded in real events and shared context to avoid irrelevant or
  untrustworthy output.
- Skantze & Irfan, "Applying General Turn-taking Models to Conversational
  Human-Robot Interaction": simplistic silence thresholds create unnatural
  pauses and interruptions; turn-taking systems should distinguish yielding,
  holding, backchannels, and interruptions.
- Amazon Science, "Natural turn-taking": production voice assistants combine
  device-directedness, barge-in handling, and user pacing cues before deciding
  whether to respond.
- Nature Humanities and Social Sciences Communications, "Why might AI-enabled
  interviews reduce candidates' job application intention?": perceived
  procedural justice and organizational attractiveness affect willingness to
  apply in AI-enabled interview formats.
- Mujtaba & Mahapatra, "Fairness in AI-Driven Recruitment": AI recruitment
  systems need transparency, candidate rights, privacy, and bias mitigation; AI
  should not make final hiring decisions without human accountability.

## Product Principles

1. Keep the interview structured.
   The agent asks planned lead questions in order. Follow-ups are bounded and
   tied to the current question.

2. Keep candidate control understandable.
   The candidate can ask for repetition, skip, pause, or answer in audio/video
   only when allowed by the recruiter configuration.

3. Ground every agent utterance.
   Agent output must map to the interview plan, current question, allowed
   follow-up, soft reprompt, or closing. Free chat is rejected.

4. Preserve comparable evidence.
   The event log must say why the system moved forward: answered, skipped,
   soft-reprompted, repeated, follow-up asked, failed.

5. Separate state policy from voice provider behavior.
   OpenAI Realtime or ElevenLabs can provide speech and transcript, but the
   Prelude state machine decides what action is allowed next.

## State Model

Use these domain states for the POC:

- `created`: worker has not joined or started.
- `joined`: worker joined the LiveKit room.
- `intro`: agent has introduced the interview context.
- `ask_question`: agent is asking or repeating the current planned question.
- `listen`: agent is waiting for candidate response.
- `evaluate_answer`: transcript/intent is finalized; policy decides whether to
  reprompt, follow up, skip, or complete the question.
- `soft_reprompt`: candidate gave silence, an incomplete answer, or unclear
  content; agent prompts once to recover.
- `single_follow_up`: agent asks one configured follow-up for the same question.
- `confirm_next`: current question is complete or skipped; safe to advance.
- `closing`: all planned questions are complete and closing is being emitted.
- `ended`: session completed.
- `failed`: unrecoverable runtime or policy failure.

## Required Transitions

- `created -> joined` on `agent_joined`
- `created|joined -> intro` on `session_started`
- `intro|confirm_next -> ask_question` on `question_asked`
- `ask_question|single_follow_up|soft_reprompt -> listen` on
  `candidate_turn_started`
- `listen -> ask_question` on `question_repeated`
- `listen -> evaluate_answer` on `candidate_turn_finalized`
- `evaluate_answer -> soft_reprompt` on `soft_reprompted`
- `evaluate_answer -> single_follow_up` on `followup_asked`
- `evaluate_answer -> confirm_next` on `question_completed`
- `single_follow_up -> listen` on `candidate_turn_started`
- `confirm_next -> closing` on `session_closing`
- `closing -> ended` on `session_completed`
- any non-terminal state -> `failed` on `session_failed`

## Guardrails

- A new planned question cannot be asked before the previous question reaches
  `confirm_next`.
- A follow-up cannot be asked before a candidate turn for that question.
- More than one contextual follow-up per configured question is rejected.
- More than one soft reprompt per question is rejected in the POC.
- `free_chat_requested` is always rejected.
- `question_repeated` must not increment the completed question count.
- `candidate_turn_finalized` must include a completion reason:
  `answered`, `skipped`, or `incomplete`.
- `question_completed` is emitted only after answer evaluation and moves the
  machine to `confirm_next`.

## Implementation Notes

- Python owns detailed interviewer policy for #16 because the runtime is there.
- Go should accept the new state-machine events and keep append-only session
  ordering/idempotency.
- The provider adapter should expose candidate intent flags, not make state
  decisions.
- The eventual realtime provider prompt must include the state-machine rules,
  especially: no free chat, no extra questions, no second follow-up, repeat only
  when asked, reprompt only for unclear/incomplete/silent answers.

## Sources

- https://home.ubalt.edu/tmitch/645/articles/McDanieletal1994CriterionValidityInterviewsMeta.pdf
- https://apps.it.purdue.edu/sites/Home/DirectoryApi/Files/1a3e516b-6dc7-41b3-8f20-537340a5bd66/Download
- https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/structured-interviews/
- https://web.stanford.edu/~jurafsky/slp3/old_jan25/15.pdf
- https://cdn.aaai.org/Symposia/Spring/2003/SS-03-06/SS03-06-006.pdf
- https://aclanthology.org/2024.neusymbridge-1.5.pdf
- https://arxiv.org/html/2501.08946v1
- https://www.amazon.science/blog/change-to-alexa-wake-word-process-adds-natural-turn-taking
- https://www.nature.com/articles/s41599-025-05607-z
- https://arxiv.org/html/2405.19699v3
