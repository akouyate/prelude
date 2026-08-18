/*
 * PURITY GUARD — this module is imported by a "use client" component
 * (`features/interview-agent/interview-agent-builder.tsx`, which resolves the
 * builder's initial language selection), so it ships in the browser bundle
 * despite living under `src/server/`.
 *
 * Keep it pure: no I/O, no `import "server-only"`, no Prisma, no `next/headers`,
 * no secrets. Adding any of those turns a client import into a build failure —
 * or worse, leaks server-side code. Anything needing I/O belongs in
 * `organization-content-languages.ts` instead, which is server-only by
 * construction.
 */
import {
  workspaceLanguageSchema,
  type WorkspaceLanguage,
} from "@prelude/contracts";

/**
 * Which language a generated artifact is written in (plan 2026-08-18, rule 1).
 *
 * Pure, no I/O: callers hand in the persisted values they already loaded. Two
 * different chains, deliberately kept apart —
 * - candidate-bound content follows the INTERVIEW language (a per-draft fact),
 * - recruiter-bound shared analysis follows the WORKSPACE language.
 *
 * Both resolve inside the en/fr catalogue pair; `WorkspaceLanguage` is simply
 * that pair's type, not a claim that the interview chain reads the workspace
 * setting.
 */

const DEFAULT_CONTENT_LANGUAGE: WorkspaceLanguage = "en";

/**
 * The interview language for a draft: the draft's own stamp wins, then the
 * workspace's `settings.interview.defaultLanguage`, then English.
 *
 * A null draft language is the normal case for anything generated before
 * stamping existed (schema rule: never backfilled), so falling through is the
 * expected path, not an error.
 */
export function resolveInterviewLanguage(
  draftLanguage: string | null | undefined,
  orgInterviewDefaultLanguage: string | null | undefined,
): WorkspaceLanguage {
  return (
    normalizeContentLanguage(draftLanguage) ??
    normalizeContentLanguage(orgInterviewDefaultLanguage) ??
    DEFAULT_CONTENT_LANGUAGE
  );
}

/**
 * The workspace language for shared generated artifacts, read from the
 * `Organization.settings.workspaceLanguage` JSON key. Anything unreadable —
 * absent key, legacy shape, tampered value — resolves to English, the setting's
 * documented default.
 */
export function resolveWorkspaceLanguage(
  settingsValue: string | null | undefined,
): WorkspaceLanguage {
  return normalizeContentLanguage(settingsValue) ?? DEFAULT_CONTENT_LANGUAGE;
}

/**
 * Case folds, then rejects anything outside the catalogue pair — `null` means
 * "this source said nothing usable", which is what lets the callers above chain
 * their fallbacks.
 *
 * Deliberately more forgiving than `coerceConsoleLocale`, which reads a value
 * produced by a controlled `<select>`: these inputs come out of a database
 * column and a free-form JSON blob, where "FR" is a plausible legacy shape. It
 * is never more forgiving than the catalogue itself — "de" or "en-US" fall
 * through rather than being guessed at.
 */
function normalizeContentLanguage(
  value: string | null | undefined,
): WorkspaceLanguage | null {
  const parsed = workspaceLanguageSchema.safeParse(
    (value ?? "").trim().toLowerCase(),
  );

  return parsed.success ? parsed.data : null;
}
