# Compliance And Candidate Trust Guardrails

Issue: #20

## Product Positioning

Prelude performs a structured AI-assisted first screen. It collects job-related
candidate answers and transcript evidence for human recruiter review. Prelude
does not make final hiring, rejection, ranking, or archive decisions.

## Candidate Disclosure Copy

Use this copy or a localized equivalent before a live interview starts:

> You are speaking with an AI-guided interviewer for a first screening. Your
> answers are reviewed by a recruiter; Prelude does not assess protected
> attributes, appearance, accent, tone, or emotion.

The candidate consent copy must also say that answers may be recorded as
transcript evidence for recruiter review.

## Recruiter Limitation Copy

Use this copy or a localized equivalent on recruiter review surfaces:

> Prelude supports human screening review only. It must not be used as an
> automated hiring or rejection decision, and it excludes protected traits,
> appearance, accent, tone, emotion, personality, and biometric signals.

## Human-In-The-Loop Rule

A human recruiter remains responsible for every hiring, rejection, follow-up, or
archive decision.

This rule applies even when an IA brief is complete, confidence appears high, or
the candidate answered every question.

## Disallowed Question And Review Topics

Prelude must not ask questions about, infer, score, or summarize:

- age
- appearance
- accent
- emotion
- ethnicity or origin
- disability or health status
- family status or pregnancy
- gender identity or sexual orientation
- religion or political opinion
- biometric or face analysis

If a candidate volunteers sensitive information, recruiter-facing analysis must
exclude it from evidence and expose that a sensitive signal was excluded or needs
human review.

## Compliance Flags

Structured review models can expose these flags:

- `human_review_required`
- `job_related_questions_only`
- `protected_traits_excluded`
- `biometric_scoring_disallowed`
- `sensitive_signal_review_required`

The first four are default flags for compliant summaries. The sensitive-signal
flag is added when volunteered sensitive information is detected and excluded
from recruiter-facing evidence.

## Implementation Notes

- `@prelude/core` owns the canonical guardrail copy, disallowed topics, and
  default compliance flags.
- `CandidateBrief` includes `complianceFlags`.
- `LiveInterviewRecruiterSummary` includes `complianceFlags` and
  `excludedSensitiveSignals`.
- Published interview plans still snapshot recruiter-approved guardrails.
- Default smoke and CI paths must not call paid LLM providers.
