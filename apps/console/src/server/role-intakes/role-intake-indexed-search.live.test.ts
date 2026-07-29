import { describe, expect, it } from "vitest";

import {
  createOpenAIRoleIntakeIndexedSearch,
  defaultRoleIntakeIndexedSearchModel,
  isVerifiedRoleIntakeSource,
} from "./role-intake-indexed-search";

const liveEnabled =
  process.env.ALLOW_LIVE_JOB_URL_TESTS === "1" &&
  Boolean(process.env.OPENAI_API_KEY);

describe.runIf(liveEnabled)("live indexed job URL intake", () => {
  const search = createOpenAIRoleIntakeIndexedSearch({
    apiKey: process.env.OPENAI_API_KEY!,
    model:
      process.env.ROLE_INTAKE_INDEXED_SEARCH_MODEL ??
      defaultRoleIntakeIndexedSearchModel,
    timeoutMs: 45_000,
  });

  it.each([
    ["LinkedIn", "https://www.linkedin.com/jobs/view/4436807221/"],
    ["Indeed", "https://fr.indeed.com/viewjob?jk=f066959d3108e72b"],
  ])(
    "extracts a current %s job with exact source evidence",
    async (_, value) => {
      const source = new URL(value);
      const result = await search(source);

      expect(result.draft.title).toBeTruthy();
      expect(result.draft.description.length).toBeGreaterThan(100);
      expect(
        result.citations.some((citation) =>
          isVerifiedRoleIntakeSource(source, new URL(citation)),
        ),
      ).toBe(true);
    },
    60_000,
  );
});
