import { describe, expect, it } from "vitest";

import { suggestReviewStatus } from "./review";

describe("suggestReviewStatus", () => {
  it("keeps incomplete submissions in review", () => {
    expect(
      suggestReviewStatus([
        { questionId: "q1", mode: "text", text: "Clear answer" },
        { questionId: "q2", mode: "text" }
      ])
    ).toBe("to_review");
  });

  it("suggests a call for complete submissions", () => {
    expect(
      suggestReviewStatus([
        { questionId: "q1", mode: "text", text: "Clear answer" }
      ])
    ).toBe("to_call");
  });
});
