import { describe, expect, it } from "vitest";

import { shouldAutoGenerateBrief } from "./brief-auto-generation";

describe("shouldAutoGenerateBrief", () => {
  it("auto-generates when evidence is ready and no brief exists yet", () => {
    expect(shouldAutoGenerateBrief("completed", undefined)).toBe(true);
  });

  it("auto-generates when evidence is ready and the brief is a pending placeholder", () => {
    // The generator writes a `pending` placeholder when evidence wasn't ready
    // before; once evidence completes, the next view should generate for real.
    expect(shouldAutoGenerateBrief("completed", "pending")).toBe(true);
  });

  it("does not re-fire while a brief is already processing (in flight)", () => {
    expect(shouldAutoGenerateBrief("completed", "processing")).toBe(false);
  });

  it("does not auto-retry a failed brief (manual retry only)", () => {
    expect(shouldAutoGenerateBrief("completed", "failed")).toBe(false);
  });

  it("does nothing when a brief is already completed", () => {
    expect(shouldAutoGenerateBrief("completed", "completed")).toBe(false);
  });

  it("waits until the runtime evidence is complete", () => {
    expect(shouldAutoGenerateBrief("not_ready", undefined)).toBe(false);
    expect(shouldAutoGenerateBrief("pending", "pending")).toBe(false);
  });
});
