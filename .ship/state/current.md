# Ship State

## Objective

Ship GitHub issue #87: Evaluation matrix and recruiter decision logic.

## Scope

- Build an evidence-based recruiter review layer for V1.
- Preserve human-owned hiring decisions: no ranking, no global fit score, no
  autonomous rejection.
- Keep current UI compatibility while adding a richer evaluation matrix contract.
- Harden live answer evaluation around vague, incoherent, off-topic, missing, and
  protected-trait scenarios.
- Add a provider-gated post-session candidate brief synthesis path with mocked
  tests by default and explicit opt-in for live LLM execution.
- Keep deterministic/local fallbacks so interview completion is not blocked by
  LLM failures.
- Added the V1 `evaluationMatrix` contract to `CandidateBriefDto` while keeping
  legacy persisted briefs valid.
- Added an env-gated OpenAI Responses adapter for post-session candidate brief
  synthesis behind the existing `CandidateBriefSynthesizer` interface.
- Wrapped the OpenAI adapter with local fallback so LLM failure does not fail
  brief generation.
- Improved local synthesis so absurd/off-topic candidate speech is not promoted
  into reviewable evidence.
- Exposed the matrix compactly in the interview detail recruiter brief.
- Hardened Python live answer inference instructions around protected-trait
  exclusion and added a protected-trait scenario.
- Updated Go realtime summary to prefer explicit evaluation matrices over
  brittle answer-length checks.
- Added `docs/sources/evaluation-matrix.md` and README links for the OpenAI,
  EEOC, NYC AEDT, and EU AI Act sources behind the implementation guardrails.

## Phases

- [x] Intake
- [x] Repository investigation
- [x] Issue refinement
- [x] Architecture review
- [x] Plan
- [x] Execution
- [x] Testing
- [x] Review
- [x] Simplification
- [x] Final validation
- [x] Delivery

## Validation

- `pnpm --dir packages/contracts test`: passed, 4 files / 23 tests.
- `pnpm --dir packages/contracts typecheck`: passed.
- `pnpm --dir apps/console test`: passed, 6 files / 37 tests.
- `pnpm --dir apps/console typecheck`: passed.
- `pnpm --dir apps/console lint`: passed.
- `services/interviewer-agent/.venv/bin/python -m pytest tests/test_answer_inference.py tests/test_orchestrator.py`:
  passed, 20 tests.
- `go test ./...` from `services/realtime`: passed, 45 tests / 7 packages.
- `git diff --check`: passed.

## Remaining Follow-Up

- Live post-session LLM smoke requires `CANDIDATE_BRIEF_LLM_ENABLED=1` and
  `OPENAI_API_KEY`; this was intentionally not run by default.
