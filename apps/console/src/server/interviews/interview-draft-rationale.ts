/*
 * PURITY GUARD — this module is imported by a "use client" component
 * (`features/interview-agent/interview-agent-builder.tsx`, which rewrites the
 * rationale when a recruiter removes a question), so it ships in the browser
 * bundle despite living under `src/server/`.
 *
 * Keep it pure: no I/O, no `import "server-only"`, no provider clients, no
 * secrets. It was split out of `interview-draft-generation.ts` for exactly this
 * reason — that module carries the OpenAI prompts, the request schemas and the
 * `OPENAI_API_KEY` lookup, none of which belong in a browser bundle. That module
 * re-exports this one, so the rationale builders still read as a set.
 */
import type { WorkspaceLanguage } from "@prelude/contracts";

/**
 * The rationale shown after a SINGLE-question edit (refine, add, or remove).
 *
 * Recruiter-bound copy, so it follows the workspace language like every other
 * rationale (plan 2026-08-18, rule 1) — the builder renders it verbatim in the
 * agent bubble and the next save persists it.
 */
export function buildQuestionEditRationale({
  change,
  questionCount,
  workspaceLanguage,
}: {
  // "removed" gets its own copy rather than reusing "added": after a deletion,
  // "HireCall prepared these N questions" would credit HireCall with a set the
  // recruiter just edited. State, not authorship.
  change: "added" | "refined" | "removed";
  questionCount: number;
  workspaceLanguage: WorkspaceLanguage;
}) {
  if (workspaceLanguage === "fr") {
    const plural = questionCount > 1 ? "s" : "";

    switch (change) {
      case "refined":
        return `HireCall a affiné une question, tout en gardant cet entretien de préqualification centré sur ${questionCount} question${plural}.`;
      case "removed":
        return `HireCall garde cet entretien de préqualification centré sur ${questionCount} question${plural}.`;
      default:
        return `HireCall a préparé ${questionCount} question${plural} ciblée${plural} pour cet entretien de préqualification.`;
    }
  }

  const plural = questionCount === 1 ? "" : "s";

  switch (change) {
    case "refined":
      return `HireCall refined one question while keeping this role screen focused on ${questionCount} first-screening question${plural}.`;
    case "removed":
      return `HireCall kept this role screen focused on ${questionCount} first-screening question${plural}.`;
    default:
      return `HireCall prepared ${questionCount} focused question${plural} for this first-screening role screen.`;
  }
}
