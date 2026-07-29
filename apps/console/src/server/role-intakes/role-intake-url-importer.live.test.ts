import { describe, expect, it } from "vitest";

import { fetchRoleIntakePublicPage } from "./role-intake-url-importer";

const liveEnabled = process.env.ALLOW_LIVE_JOB_URL_TESTS === "1";

describe.runIf(liveEnabled)("live public job URL intake", () => {
  it(
    "extracts a current Greenhouse job through the direct public-page importer",
    async () => {
      const result = await fetchRoleIntakePublicPage(
        "https://job-boards.greenhouse.io/proton/jobs/4911620101",
        { indexedSearch: null },
      );

      expect(result.acquisitionStrategy).toBe("direct_html");
      expect(result.draft.title).toContain(
        "Identity and Access Management",
      );
      expect(result.draft.description.length).toBeGreaterThan(500);
      expect(result.canonicalUrl).toBe(
        "https://job-boards.greenhouse.io/proton/jobs/4911620101",
      );
    },
    30_000,
  );
});
