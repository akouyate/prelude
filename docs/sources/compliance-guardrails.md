# V1 Compliance Guardrails Sources

Issue: #64

This note explains the source rationale behind Prelude V1 compliance copy and
AI synthesis guardrails. It is product guidance for implementation, not legal
advice.

## Product Rules

- Candidates must know they are speaking with an AI-guided interviewer before
  joining the room.
- Candidates must consent before answers are recorded and transcribed.
- Recruiters remain responsible for hiring, rejection, follow-up, and archive
  decisions.
- Interview questions and synthesis must remain job-related.
- Protected traits, biometric signals, appearance, accent, tone, emotion,
  disability, health, family status, pregnancy, ethnicity, gender identity,
  sexual orientation, religion, and political opinion must not be requested,
  scored, inferred, or used as recruiter-facing evidence.
- If a candidate volunteers protected or sensitive information, synthesis
  excludes it from evidence and flags that sensitive information was excluded
  for human review.

## Source Rationale

- EEOC Artificial Intelligence and Algorithmic Fairness initiative: employers
  using AI and algorithmic hiring tools still need to comply with federal civil
  rights law, and AI can mask or perpetuate bias.
- EEOC/DOJ ADA guidance: employer AI tools can violate disability law when they
  screen out people with disabilities, fail to allow reasonable accommodations,
  or lead to disability-related inquiries.
- NYC Local Law 144 AEDT guidance: automated employment decision tools can
  trigger notice and audit requirements when used for employment decisions.
- EU AI Act regulatory framework: employment and recruitment AI is high-risk;
  prohibited practices include workplace emotion recognition and biometric
  categorization to deduce protected characteristics; high-risk systems require
  logging, documentation, human oversight, robustness, and transparency.

## Implementation Mapping

- `@prelude/core` owns canonical copy, copy versions, disallowed topics, default
  flags, and the prompt context builder.
- Candidate app displays disclosure copy and stores the consent copy version at
  session creation or resume.
- Console app displays recruiter limitation copy on review surfaces.
- AI synthesis prompts receive the canonical disallowed topic list and
  sensitive-information handling rule.
- Automated tests mock LLM providers by default; live provider validation stays
  explicit and opt-in.

## References

- EEOC: `https://www.eeoc.gov/newsroom/eeoc-launches-initiative-artificial-intelligence-and-algorithmic-fairness`
- EEOC/DOJ: `https://www.eeoc.gov/newsroom/us-eeoc-and-us-department-justice-warn-against-disability-discrimination`
- NYC DCWP: `https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page`
- European Commission: `https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai`
