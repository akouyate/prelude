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

- Keep #39 as prompt-level behavior for the POC.
- Do not add `InterviewPlan` fields yet because the current runtime only has
  `role_title`, language, modalities, and planned questions.
- Preserve the structured interview state machine and first-screening scope.
- Add explicit prompt sections for candidate onboarding, role adaptation,
  candidate comfort, and listening/pacing.
- Test for the intended guardrails rather than exact LLM phrasing.

## Validation

- `uv run --with-requirements requirements.txt python -m compileall app` in
  `services/interviewer-agent`: passed.
- `uv run --with-requirements requirements.txt python -m pytest -q` in
  `services/interviewer-agent`: 54 passed.
- `git diff --check`: passed.
- Live audio smoke was not rerun because this change only updates prompt
  instructions and focused prompt tests; manual candidate feel remains the next
  subjective validation step.
