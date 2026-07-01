import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  resolveAnalysisStatus,
  resolveReviewStatus,
} from "./live-session-insights";

describe("live session insights", () => {
  it("surfaces non-complete brief labels instead of hiding them as pending", () => {
    expect(resolveAnalysisStatus("abandoned", undefined, "partial")).toBe(
      "partial",
    );
    expect(
      resolveAnalysisStatus("completed", undefined, "insufficient_signal"),
    ).toBe("insufficient_signal");
    expect(
      resolveAnalysisStatus("failed", undefined, "technical_failure"),
    ).toBe("technical_failure");
  });

  it("keeps incomplete or failed candidate lifecycle states out of the review queue", () => {
    expect(resolveReviewStatus("abandoned")).toBe("archived");
    expect(resolveReviewStatus("failed")).toBe("archived");
    expect(resolveReviewStatus("expired")).toBe("archived");
    expect(resolveReviewStatus("superseded")).toBe("archived");
    expect(resolveReviewStatus("completed")).toBe("to_review");
  });
});
