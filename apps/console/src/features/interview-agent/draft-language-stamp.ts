import type { WorkspaceLanguage } from "@prelude/contracts";

/**
 * Whether a builder save may carry the interview language at all.
 *
 * The builder always HAS a concrete language on screen — a legacy draft with a
 * null column still has to render the selector on something, so it falls back
 * to the workspace default. Sending that displayed value on every save would
 * quietly backfill the column with today's workspace default for drafts whose
 * questions were written before stamping existed, which plan 2026-08-18 rule 6
 * forbids ("null means generated before stamping existed; never backfill").
 *
 * So the payload fragment is empty unless one of three things is true:
 *  - the recruiter moved the selector in this session (an explicit choice),
 *  - the draft already carries a stamp (resending the same value is a no-op,
 *    and it is the only way an explicit change can reach an existing row), or
 *  - the draft has never been persisted (creation is exactly when the stamp is
 *    supposed to be written).
 *
 * Returning a spreadable fragment rather than a boolean keeps the decision and
 * the payload shape in one place: `{ ...draftLanguagePatch(...) }` is either
 * nothing or the one key, and the caller cannot get the two out of step.
 */
export function draftLanguagePatch({
  hasPersistedDraft,
  hasPersistedLanguage,
  language,
  languageTouched,
}: {
  hasPersistedDraft: boolean;
  hasPersistedLanguage: boolean;
  language: WorkspaceLanguage;
  languageTouched: boolean;
}): { language?: WorkspaceLanguage } {
  if (languageTouched || hasPersistedLanguage || !hasPersistedDraft) {
    return { language };
  }

  return {};
}
