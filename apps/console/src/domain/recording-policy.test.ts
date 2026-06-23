import { describe, expect, it } from "vitest";

import { canDeleteRecording } from "./recording-policy";

describe("canDeleteRecording", () => {
  // Erasing a candidate's voice recording is destructive and irreversible, so it
  // is stricter than review management (which recruiters may also do).
  it("allows owners and admins", () => {
    expect(canDeleteRecording("owner")).toBe(true);
    expect(canDeleteRecording("admin")).toBe(true);
  });

  it("forbids recruiters and viewers", () => {
    expect(canDeleteRecording("recruiter")).toBe(false);
    expect(canDeleteRecording("viewer")).toBe(false);
  });
});
