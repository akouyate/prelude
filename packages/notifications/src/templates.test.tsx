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
    expect(html).toContain("HireCall does not make hiring decisions.");
    expect(html).not.toContain("recommendation");
    expect(html).not.toContain("evidence");
  });

  it("renders concise recruiter templates with a candidate record link", async () => {
    const props = {
      candidateLabel: "Ada Martin",
      detailUrl: "https://console.hirecall.ai/interviews/cs_123",
      locale: "en" as const,
      roleTitle: "Customer Success Manager",
    };

    await expect(
      render(<RecruiterBriefReadyEmail {...props} />),
    ).resolves.toContain("Open candidate");
    await expect(
      render(<RecruiterBriefNeedsAttentionEmail {...props} />),
    ).resolves.toContain("Review candidate");
  });

  // T4 threads a `locale` prop into these templates for the audit trail, but
  // the copy stays English until the notifications-i18n ticket translates it
  // — a "fr" recipient must render byte-identical body copy to "en" today.
  it("keeps rendering English copy regardless of the recipient's locale", async () => {
    const baseProps = {
      candidateLabel: "Ada Martin",
      detailUrl: "https://console.hirecall.ai/interviews/cs_123",
      roleTitle: "Customer Success Manager",
    };

    const [enHtml, frHtml] = await Promise.all([
      render(<RecruiterBriefReadyEmail {...baseProps} locale="en" />),
      render(<RecruiterBriefReadyEmail {...baseProps} locale="fr" />),
    ]);

    expect(frHtml).toEqual(enHtml);
    expect(frHtml).toContain("Screen ready for review");
  });
});
