import { describe, expect, it } from "vitest";

import { nextDraftSaveStatus } from "./draft-save-status";

describe("nextDraftSaveStatus", () => {
  it("marks the draft saved after a save", () => {
    expect(nextDraftSaveStatus("save")).toBe("saved");
  });

  it("marks the role screen published after a publish", () => {
    expect(nextDraftSaveStatus("publish")).toBe("published");
  });

  // THE INVARIANT (see N16 in interview-agent-builder.tsx): the persistent
  // saved/published marker means "what you see equals what is persisted". Any
  // edit after a save (or publish) must clear it — a stale "Saved" badge next
  // to unsaved changes is worse than no badge at all.
  it("INVARIANT: an edit after a save clears the persistent marker", () => {
    const saved = nextDraftSaveStatus("save");
    expect(saved).toBe("saved");

    const afterEdit = nextDraftSaveStatus("clear");
    expect(afterEdit).toBeUndefined();
  });

  it("INVARIANT: an edit after a publish clears the persistent marker", () => {
    const published = nextDraftSaveStatus("publish");
    expect(published).toBe("published");

    const afterEdit = nextDraftSaveStatus("clear");
    expect(afterEdit).toBeUndefined();
  });
});
