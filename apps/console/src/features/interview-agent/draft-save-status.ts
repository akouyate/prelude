/**
 * The dirty-bit transition table behind the builder's persistent saved/
 * published marker (see N16 in interview-agent-builder.tsx).
 *
 * `markDraftDirty` (any edit) and a fresh generate both invalidate whatever
 * was persisted, so both map to the `"clear"` transition below and collapse
 * to the same `undefined` result — regardless of the status they're
 * clearing. That collapse IS the invariant: a `"saved"` or `"published"`
 * marker never survives an edit.
 */
export type DraftSaveStatus = "saved" | "published" | undefined;

export type DraftSaveTransition = "save" | "publish" | "clear";

export function nextDraftSaveStatus(
  transition: DraftSaveTransition,
): DraftSaveStatus {
  switch (transition) {
    case "save":
      return "saved";
    case "publish":
      return "published";
    case "clear":
      return undefined;
  }
}
