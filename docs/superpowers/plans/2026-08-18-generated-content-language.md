# Generated-content language: the language follows the recipient

**History.** The console i18n chantier (#159) closed every interface string, which made the
remaining gap visible: LLM-generated content (candidate brief, criterion notes, agent
rationale, draft questions) always comes out in English — the prompts carry zero language
instruction. Plan refined 2026-08-18, user ratified same day: GO + **explicit workspace
language setting** (over deriving it from the interview default). Team execution: Opus 5
implementers under TDD, Sonnet 5 QA, orchestrator reviews every diff.

## Ground truth (verified 2026-08-18)

- `interview-draft-generation.ts` and `candidate-brief-openai.ts` prompts contain **no
  language instruction at all** — output language is whatever the model defaults to.
- `Organization.settings.interview.defaultLanguage` ("en"|"fr", default "en") exists and is
  read **only by the settings page** — nothing downstream consumes it yet.
- `InterviewDraft`, `Interview`, `CandidateBrief` have **no language column**.
- The Python worker is fully bilingual: `InterviewPlan.language` drives a complete delivery
  layer (`_delivery_language_key`, FR/EN transitions, reprompts, language discipline in the
  system prompt). Default "fr".
- The Go store **pins** `language := "fr"` (`postgres.go:237`, `service.go:2022`) with a
  comment saying exactly this chantier should thread the real value.
- The protected-topic classifier already catches "ANY language" and writes its `reason` in
  the recruiter's UI language (N6d). No work needed there beyond a French-input test.

## Binding product rules

1. **The language follows the recipient, per artifact — never per reader.**
   - **Candidate-bound content** (published questions, guardrails, live interview conduct):
     the **interview language**, a per-draft fact. Default at draft creation:
     `settings.interview.defaultLanguage`. Recruiter-editable in the builder.
   - **Recruiter-bound durable analysis** (CandidateBrief summary, criterion notes,
     recommendation, limitations): the **workspace language**. A brief is one shared
     artifact read by many teammates — generating per reader would fork the evidence.
   - **Draft criteria and guardrails**: interview language. They anchor the published
     immutable snapshot; transcript, verbatim quotes and criteria stay one monolingual
     evidence chain. **Draft rationale**: workspace language (builder UI copy addressed to
     the recruiter).
2. **`Organization.settings.workspaceLanguage`** ("en"|"fr", default "en"): new explicit
   setting, stored in the settings JSON (no schema column), written exclusively by
   `updateWorkspaceProfile` (owner/admin gate as-is), next to the country select. **Wall
   against org-profile rule 2** ("No `Organization.preferredLanguage` — ever"): that rule
   governs per-recipient messages (notifications, UI) and stands untouched —
   `User.preferredLanguage` keeps driving those. `workspaceLanguage` governs only **shared
   generated artifacts**, which cannot be per-recipient. Any PR pointing a
   notification/UI read at `workspaceLanguage` violates both rules. Name this wall in a
   comment at the setting's definition.
3. **Generate natively, never post-translate.** One explicit output-language directive in
   the prompt; prompt instructions themselves stay English (models follow English
   instructions best); JSON schema keys stay English, only values are localized. No
   post-hoc translation pass, ever.
4. **Candidate quotes stay verbatim** in the language actually spoken — they are audit
   evidence tied to transcript turns. The prompt must say so explicitly.
5. **Deterministic parity.** The deterministic draft generator is the prod fallback when
   the LLM call fails (and the CI generator). It gains FR templates; a failed OpenAI call
   must never silently switch the product's language. Same for any deterministic/fallback
   brief path.
6. **Stamp `language` on the artifacts**: `InterviewDraft.language`, `Interview.language`
   (copied at publish), `CandidateBrief.language` — all `String?`. `null` means "generated
   before stamping existed"; never backfill. The brief page shows an honest badge when
   `brief.language` is null or differs from the workspace language.
7. **Unpin the live pipeline.** Thread `Interview.language` through the realtime snapshot
   into `application.InterviewPlan.Language`; delete the pinned `"fr"` at both sites.
   Missing/legacy snapshot language falls back to "fr" (current behavior — no regression
   for already-published interviews). The Python worker needs no change.
8. **Verification.** TDD throughout (failing test first, then code). Gated live tests
   (`ALLOW_LIVE_LLM_TESTS=1`) assert a FR generation actually returns French (stopword
   heuristic — no heavyweight langdetect dependency). Deterministic e2e smoke gains a FR
   variant. Final gate: HR-expert + AI-expert review (house rule for AI-touching business
   logic).

## Tasks (Opus 5 implementers, TDD; Sonnet 5 QA per task; orchestrator reviews all diffs)

- **GL-T1 — Language becomes a persisted fact** (schema + contracts + setting):
  migration adding the three nullable `language` columns; `workspaceLanguageSchema` +
  draft/interview/brief contract updates in `@prelude/contracts`; `workspaceLanguage`
  setting (rule 2) with settings UI field EN/FR; pure resolution helpers
  `resolveInterviewLanguage` / `resolveWorkspaceLanguage`. `make db-generate`.
- **GL-T2 — Draft generation speaks the interview language**: OpenAI prompt directive
  (questions/criteria/guardrails → interview language; rationale → workspace language);
  deterministic generator FR templates; draft stamped at creation; builder language
  selector; gated live FR test.
- **GL-T3 — Brief generation speaks the workspace language**: prompt directive + verbatim
  quotes rule; `CandidateBrief.language` stamped at generation; fallback/regeneration
  parity (regeneration uses the *current* workspace language); gated live FR test;
  French-input classifier test.
- **GL-T4 — End-to-end coherence**: publish copies `draft.language` → `Interview.language`;
  realtime snapshot carries it; Go unpins "fr" (both sites) with Go tests; brief language
  badge; deterministic e2e smoke FR variant.
- **GL-QA — Final gate**: HR-expert (question quality in FR is a business concern, not
  translation) + AI-expert (prompt design, output-language robustness) + full verification
  suite (typecheck, unit, services, e2e smoke).

Sequencing: T1 → (T2 ∥ T3, disjoint file scopes; locale keys: T2 owns `interviewBuilder.*`,
T3 owns `candidateReview.*`) → T4 → QA gate.

## What NOT to build

No post-hoc translation of any artifact. No backfill of legacy `language` nulls. No
per-reader brief generation. No `Organization.preferredLanguage` column (rule 2 wall). No
change to notification/UI locale plumbing. No new languages beyond en/fr (the catalogue
pair). No langdetect-style dependency for tests.
