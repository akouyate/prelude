import { render } from "react-email";
import { describe, expect, it } from "vitest";

import {
  CandidateInterviewCompletedEmail,
  RecruiterBriefNeedsAttentionEmail,
  RecruiterBriefReadyEmail,
} from "./templates";

describe("notification templates", () => {
  it("renders a candidate confirmation without recruiter-only analysis", async () => {
    const html = await render(
      <CandidateInterviewCompletedEmail
        companyName="Acme Talent"
        roleTitle="Customer Success Manager"
      />,
    );

    expect(html).toContain("Your interview is complete");
    expect(html).toContain("Prelude does not make hiring decisions.");
    expect(html).not.toContain("recommendation");
    expect(html).not.toContain("evidence");
  });

  it("renders concise recruiter templates with a candidate record link", async () => {
    const props = {
      candidateLabel: "Ada Martin",
      detailUrl: "https://console.prelude.ai/interviews/cs_123",
      roleTitle: "Customer Success Manager",
    };

    await expect(
      render(<RecruiterBriefReadyEmail {...props} />),
    ).resolves.toContain("Open candidate");
    await expect(
      render(<RecruiterBriefNeedsAttentionEmail {...props} />),
    ).resolves.toContain("Review candidate");
  });
});
