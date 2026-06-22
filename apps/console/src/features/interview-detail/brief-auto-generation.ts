/**
 * #5 — decide whether to AUTO-generate the candidate brief when a recruiter opens
 * a completed candidate session, instead of waiting for a manual click.
 *
 * Auto-fire ONLY when the runtime evidence is ready and there is no usable brief
 * yet — either none at all, or a `pending` placeholder left from an earlier
 * not-ready attempt. Never auto-fire while one is already `processing` (in
 * flight), nor after a `failed` one (the recruiter retries manually), nor when
 * one is already `completed`. The generator is itself idempotent and evidence-
 * gated; this rule keeps the view from looping or silently re-running.
 */
export function shouldAutoGenerateBrief(
  evidenceStatus: string,
  briefStatus: string | undefined,
): boolean {
  if (evidenceStatus !== "completed") {
    return false;
  }

  return briefStatus === undefined || briefStatus === "pending";
}
