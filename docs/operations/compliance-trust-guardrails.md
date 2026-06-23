# Compliance And Candidate Trust Guardrails

Issue: #20

## Product Positioning

Prelude performs a structured AI-assisted first screen. It collects job-related
candidate answers and transcript evidence for human recruiter review. Prelude
does not make final hiring, rejection, ranking, or archive decisions.

## Candidate Disclosure Copy

Canonical copy version: `candidate-disclosure-v2`.

Use this copy or a localized equivalent before a live interview starts:

> You are speaking with an AI-guided interviewer for a first screening. This
> interview is audio-recorded so a recruiter can review your answers later. Your
> answers are reviewed by a recruiter; Prelude does not assess protected
> attributes, appearance, accent, tone, or emotion.

The candidate consent copy must disclose that the candidate's **voice is
audio-recorded** (not only transcribed), the purpose (recruiter replay), the
**retention period** (kept up to 90 days, then permanently deleted), the **right
to request deletion** at any time, and that the audio is **stored in the EU** and
processed by Prelude's recording provider (LiveKit / Cloudflare R2).

Canonical consent copy version: `candidate-consent-v2`. Only sessions consented
under `candidate-consent-v2`+ may be audio-recorded — `candidate-consent-v1`
disclosed transcript evidence only and must never be audio-recorded.

## Recruiter Limitation Copy

Canonical copy version: `recruiter-limitation-v1`.

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

The source links behind these evaluation and compliance guardrails are tracked
in [`docs/sources/evaluation-matrix.md`](../sources/evaluation-matrix.md) and
[`docs/sources/compliance-guardrails.md`](../sources/compliance-guardrails.md).
