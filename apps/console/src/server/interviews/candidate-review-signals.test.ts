import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toCandidateBriefView } from "./candidate-review-signals";

const completedSummary = (candidateSessionId: string) => ({
  candidateSessionId,
  criteria: [],
  limitations: ["Short interview."],
  status: "completed",
  summary: "Concrete answers on incident handling.",
});

describe("toCandidateBriefView", () => {
  it("returns nothing for a session that has no brief row at all", () => {
    const view = toCandidateBriefView(null);

    expect(view.content).toBeNull();
    expect(view.language).toBeNull();
    expect(view.regenerationFailed).toBe(false);
  });

  it("exposes the stamped language of a completed brief", () => {
    const view = toCandidateBriefView({
      candidateSessionId: "cs_1",
      language: "fr",
      limitations: [],
      status: "completed",
      summaryJson: completedSummary("cs_1"),
    });

    expect(view.content?.status).toBe("completed");
    expect(view.language).toBe("fr");
    expect(view.regenerationFailed).toBe(false);
  });

  it("reports a legacy brief stamped before language existed as unknown", () => {
    const view = toCandidateBriefView({
      candidateSessionId: "cs_1",
      language: null,
      limitations: [],
      status: "completed",
      summaryJson: completedSummary("cs_1"),
    });

    expect(view.content?.status).toBe("completed");
    expect(view.language).toBeNull();
  });

  // The regression that motivated this seam: the DTO is built from summaryJson
  // alone, and a failed REGENERATION leaves the previous success's summaryJson
  // in place. Reading the status out of that JSON therefore reports "completed"
  // while the row says "failed" — the failure was invisible to the recruiter.
  it("exposes BOTH the stale content and the failure of a failed regeneration", () => {
    const view = toCandidateBriefView({
      candidateSessionId: "cs_1",
      language: "en",
      limitations: [],
      status: "failed",
      summaryJson: completedSummary("cs_1"),
    });

    expect(view.content?.summary).toBe(
      "Concrete answers on incident handling.",
    );
    expect(view.content?.status).toBe("completed");
    expect(view.regenerationFailed).toBe(true);
  });

  it("keeps a first-ever failure out of the regeneration path", () => {
    const view = toCandidateBriefView({
      candidateSessionId: "cs_1",
      language: null,
      limitations: ["Synthesis failed."],
      status: "failed",
      summaryJson: null,
    });

    // No parseable content: the page must keep showing the existing pending /
    // failed state rather than a "showing the previous version" notice.
    expect(view.regenerationFailed).toBe(false);
    expect(view.content?.status).toBe("failed");
  });
});
