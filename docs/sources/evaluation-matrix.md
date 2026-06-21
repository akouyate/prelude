# Evaluation Matrix Sources

Last reviewed: 2026-06-21

This file tracks the sources that inform Prelude's evaluation matrix,
post-session candidate brief synthesis, and live answer inference guardrails.

## OpenAI Implementation Sources

- [OpenAI Responses API: create a response](https://platform.openai.com/docs/api-reference/responses/create)
- [OpenAI structured outputs guide](https://platform.openai.com/docs/guides/structured-outputs)

Why it matters:

- The post-session candidate brief adapter uses the Responses API as a
  provider-specific implementation behind Prelude's `CandidateBriefSynthesizer`
  boundary.
- Structured output guidance informs the JSON-shaped response contract, while
  Prelude's Zod schemas remain the final validation authority.

## Employment AI And Human Review Sources

- [EEOC AI and algorithmic fairness initiative](https://www.eeoc.gov/newsroom/eeoc-launches-initiative-artificial-intelligence-and-algorithmic-fairness)
- [NYC Automated Employment Decision Tools page](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page)
- [EU AI Act high-risk systems guidance](https://digital-strategy.ec.europa.eu/en/policies/guidelines-ai-high-risk-systems)

Why it matters:

- Prelude is positioned as a recruiter-assist first-screening workflow, not an
  automated hiring, ranking, rejection, or archive decision system.
- Recruiter-facing analysis must remain evidence-backed, job-related, and
  explicitly human-reviewed.
- Protected traits, biometric interpretation, accent, tone, emotion, identity,
  disability, health, family status, age, ethnicity, gender, religion, and other
  sensitive attributes must not be used as evaluation criteria.

## Implementation Notes

- `packages/contracts/src/schemas/brief.ts` defines the recruiter-facing
  evaluation matrix contract.
- `apps/console/src/server/interviews/candidate-brief-openai.ts` implements the
  OpenAI Responses adapter behind `CandidateBriefSynthesizer`.
- `apps/console/src/server/interviews/candidate-brief-generation.ts` keeps local
  fallback synthesis as the default and prevents LLM failure from failing brief
  generation.
- `services/interviewer-agent/app/adapters/answer_inference.py` applies the same
  guardrails to live answer inference.
- `services/realtime/internal/application/summary.go` consumes evaluation
  matrices as evidence for recruiter summaries.

## Testing Rule

Automated tests must not call paid LLM providers by default. Live LLM smoke paths
must be explicit and opt-in with flags such as `ALLOW_LIVE_LLM_TESTS=1`,
`CANDIDATE_BRIEF_LLM_ENABLED=1`, and the required provider credentials.
