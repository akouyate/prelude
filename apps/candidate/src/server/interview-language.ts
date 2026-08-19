import {
  workspaceLanguageSchema,
  type WorkspaceLanguage,
} from "@prelude/contracts";

/**
 * The language the candidate pre-join surfaces render in: the AI disclosure, the
 * consent text the candidate ticks, and the chrome around them.
 *
 * Rendering language = `interview.language` when it is "en" or "fr"
 * (case-folded), else "fr" — because the Go realtime store falls back to "fr"
 * for null/legacy snapshots (`services/realtime`, `postgres.go`
 * `resolveStoredLanguage`), and the consent must be in the language the
 * interview will ACTUALLY be conducted in.
 *
 * That is why this deliberately does NOT share the console's
 * `resolveInterviewLanguage`, whose fallback is English: the console resolves
 * what a recruiter is about to author, this resolves what a candidate is about
 * to be spoken to in. Same catalogue pair, opposite default, on purpose.
 *
 * Pure and I/O-free: the caller hands in the value it already loaded, and the
 * one resolved result is used for BOTH the copy selection and the
 * `consentLanguage` stamp, so the recorded language can never drift from the
 * rendered one.
 */
export function resolveCandidateRenderingLanguage(
  interviewLanguage: string | null | undefined,
): WorkspaceLanguage {
  const parsed = workspaceLanguageSchema.safeParse(
    (interviewLanguage ?? "").trim().toLowerCase(),
  );

  return parsed.success ? parsed.data : "fr";
}
