import { describe, expect, it } from "vitest";

import { fetchRoleIntakePublicPage } from "./role-intake-url-importer";

const liveEnabled = process.env.ALLOW_LIVE_JOB_URL_TESTS === "1";

/**
 * These hit the real providers, so they stay opt-in. They exist because the
 * failure modes that matter here are not reproducible from fixtures: an origin
 * that starts refusing the importer, a board that turns into a client-rendered
 * shell, or a payload whose markup encoding changes.
 */
describe.runIf(liveEnabled)("live public job URL intake", () => {
  it(
    "reads a Greenhouse posting through the ATS public API",
    async () => {
      const result = await fetchRoleIntakePublicPage(
        "https://job-boards.greenhouse.io/anthropic/jobs/5023394008",
        { indexedSearch: null },
      );

      expect(result.acquisitionStrategy).toBe("ats_api");
      expect(result.extractorVersion).toBe("ats-api-v1:greenhouse");
      expect(result.fieldSources.description).toBe("ats_public_api");
      expect(result.draft.title).toBeTruthy();
      expect(result.draft.location).toBeTruthy();
      expect(result.draft.description.length).toBeGreaterThan(500);
      // Greenhouse escapes the markup it returns; a decoding regression shows up
      // as tag names surfacing in the recruiter-visible description.
      expect(result.draft.description).not.toContain("<p>");
      expect(result.draft.description).not.toContain("&lt;");
    },
    30_000,
  );

  it(
    "reads a Lever posting through the ATS public API",
    async () => {
      const result = await fetchRoleIntakePublicPage(
        "https://jobs.lever.co/leverdemo/33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
        { indexedSearch: null },
      );

      expect(result.acquisitionStrategy).toBe("ats_api");
      expect(result.extractorVersion).toBe("ats-api-v1:lever");
      expect(result.draft.title).toBeTruthy();
      expect(result.draft.description.length).toBeGreaterThan(500);
    },
    30_000,
  );

  it(
    "reads an Ashby posting whose board page is a client-rendered shell",
    async () => {
      const result = await fetchRoleIntakePublicPage(
        "https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
        { indexedSearch: null },
      );

      expect(result.acquisitionStrategy).toBe("ats_api");
      expect(result.extractorVersion).toBe("ats-api-v1:ashby");
      expect(result.draft.description.length).toBeGreaterThan(500);
    },
    30_000,
  );

  it(
    "reads a job board that publishes JobPosting JSON-LD in its page",
    async () => {
      const result = await fetchRoleIntakePublicPage(
        "https://www.hellowork.com/fr-fr/emplois/82054407.html",
        { indexedSearch: null },
      );

      expect(result.acquisitionStrategy).toBe("direct_html");
      expect(result.fieldSources).toEqual({
        description: "job_posting_json_ld",
        location: "job_posting_json_ld",
        title: "job_posting_json_ld",
      });
      expect(result.draft.description.length).toBeGreaterThan(500);
    },
    30_000,
  );
});
