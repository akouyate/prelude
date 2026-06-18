# Ship State

## Objective

Ship issue #39: adapt the live interviewer tone by role and sector without
hardcoded scripts, grounded in research on structured interviews, candidate
experience, active listening, and conversational-agent pacing.

## Source

- Current ticket: https://github.com/akouyate/prelude/issues/39
- OPM structured interviews:
  https://www.opm.gov/policy-data-oversight/assessment-and-selection/other-assessment-methods/structured-interviews/
- SIOP candidate experience white paper:
  https://www.siop.org/wp-content/uploads/legacy/docs/White%20Papers/candidate%20experience.pdf
- Basch & Melchers on video interview explanations:
  https://scholarworks.bgsu.edu/pad/vol5/iss3/2/
- Active listening study:
  https://stars.library.ucf.edu/scopus2010/9657/
- Chatbot empathy study:
  https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1282036/full
- Context-aware conversational-agent pacing:
  https://arxiv.org/html/2602.06134v1

## Phases

- [x] Intake
- [x] Repository investigation
- [x] Skill loading
- [x] Architecture review
- [x] Plan
- [x] Team decision
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [ ] Delivery

## Team

- Orchestrator: main Codex thread, owns issue refinement, implementation, tests,
  and PR.
- Agents used: none for this narrow implementation. Research was applied directly
  to the live interviewer prompt and tests.

## Architecture Decision

- Keep #39 in the existing Go realtime API + Python worker architecture.
- Add a small structured `interview_style` object to `InterviewPlan` instead of
  introducing a new style service or persistence layer.
- Have Go `/agent-config` return sector, seniority, work environment, role
  constraints, company context, and candidate tone for the demo plan.
- Have the Python worker parse that context and use it first when generating
  live interviewer instructions.
- Preserve fallback inference from role title and planned questions for older or
  minimal plans that do not include `interview_style`.
- Preserve the structured interview state machine and first-screening scope.
- Test the contract at Go HTTP, Go application, Python realtime client, and
  Python prompt levels.

## Validation

- `uv run --with-requirements requirements.txt python -m compileall app` in
  `services/interviewer-agent`: passed.
- `uv run --with-requirements requirements.txt python -m pytest -q` in
  `services/interviewer-agent`: 54 passed before greeting refinement.
- `uv run --with-requirements requirements.txt python -m pytest
  tests/test_livekit_openai_worker.py -q` in `services/interviewer-agent`:
  15 passed after greeting refinement.
- `git diff --check`: passed.
- Final `uv run --with-requirements requirements.txt python -m pytest -q` in
  `services/interviewer-agent`: 56 passed.
- Full implementation `uv run --with-requirements requirements.txt python -m
  pytest -q` in `services/interviewer-agent`: 57 passed.
- Full implementation `go test ./...` in `services/realtime`: 22 passed.
- Automated LiveKit/OpenAI smoke with Playwright fake media:
  - Session `is_32a09352e0ab16d59fb12d67` exposed repeated onboarding/greeting
    when the fake mic interrupted the agent.
  - Session `is_dfe0ce1b88c147edb4e4fbce` confirmed the issue persisted before
    stripping greetings from speech prompts.
  - Session `is_280058263374e8521fc719ed` confirmed the live agent produced a
    cleaner first spoken turn: one greeting, one structured onboarding sentence,
    then the first question without repeating `Bonjour`.
- Manual human audio feel remains the next subjective validation step because
  Playwright fake media can produce noisy candidate transcripts.
