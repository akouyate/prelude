import { describe, expect, it, vi } from "vitest";

import {
  createOpenAIRoleIntakeIndexedSearch,
  createRoleIntakeIndexedSearchFromEnv,
  isVerifiedRoleIntakeSource,
} from "./role-intake-indexed-search";

describe("indexed job URL source verification", () => {
  it.each([
    [
      "https://www.linkedin.com/jobs/view/senior-engineer-4430499568/",
      "https://www.linkedin.com/jobs/view/4430499568?trk=public_jobs",
    ],
    [
      "https://fr.indeed.com/viewjob?jk=f066959d3108e72b",
      "https://www.indeed.com/viewjob?jk=f066959d3108e72b&utm_source=search",
    ],
    [
      "https://careers.example.com/jobs/123/",
      "https://careers.example.com/jobs/123",
    ],
  ])("accepts matching source evidence for %s", (submitted, cited) => {
    expect(isVerifiedRoleIntakeSource(new URL(submitted), new URL(cited))).toBe(
      true,
    );
  });

  it.each([
    [
      "https://www.linkedin.com/jobs/view/4430499568/",
      "https://www.linkedin.com/jobs/view/9999999999/",
    ],
    [
      "https://fr.indeed.com/viewjob?jk=f066959d3108e72b",
      "https://fr.indeed.com/viewjob?jk=another-job",
    ],
    [
      "https://careers.example.com/jobs/123",
      "https://careers.example.com/jobs/456",
    ],
  ])("rejects unrelated evidence for %s", (submitted, cited) => {
    expect(isVerifiedRoleIntakeSource(new URL(submitted), new URL(cited))).toBe(
      false,
    );
  });
});

describe("OpenAI indexed job search adapter", () => {
  it("stays disabled unless explicitly configured outside tests", () => {
    expect(
      createRoleIntakeIndexedSearchFromEnv({
        NODE_ENV: "production",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toBeNull();
    expect(
      createRoleIntakeIndexedSearchFromEnv({
        NODE_ENV: "test",
        OPENAI_API_KEY: "sk-test",
        ROLE_INTAKE_INDEXED_SEARCH_ENABLED: "1",
      }),
    ).toBeNull();
    expect(
      createRoleIntakeIndexedSearchFromEnv({
        NODE_ENV: "production",
        OPENAI_API_KEY: "sk-test",
        ROLE_INTAKE_INDEXED_SEARCH_ENABLED: "1",
      }),
    ).toEqual(expect.any(Function));
  });

  it("uses general search for LinkedIn and returns only verified citations", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      json: async () => ({
        output: [
          {
            action: {
              type: "open_page",
              url: "https://www.linkedin.com/jobs/view/4430499568/",
            },
            type: "web_search_call",
          },
          {
            action: {
              sources: [
                {
                  title: "Senior Software Engineer - AI (EMEA)",
                  url: "https://www.linkedin.com/jobs/view/4430499568/",
                },
                {
                  title: "Unrelated result",
                  url: "https://www.linkedin.com/jobs/view/9999999999/",
                },
              ],
              type: "search",
            },
            type: "web_search_call",
          },
        ],
        output_text: JSON.stringify({
          canonicalUrl: "https://www.linkedin.com/jobs/view/4430499568/",
          description:
            "Build reliable production AI systems and collaborate across distributed engineering teams.",
          location: "Nice, France",
          sourceUrl: "https://www.linkedin.com/jobs/view/4430499568/",
          title: "Senior Software Engineer - AI (EMEA)",
        }),
      }),
      ok: true,
      status: 200,
    });
    const search = createOpenAIRoleIntakeIndexedSearch({
      apiKey: "sk-test",
      fetcher,
      model: "gpt-5.6-luna",
      timeoutMs: 5_000,
    });

    const result = await search(
      new URL("https://www.linkedin.com/jobs/view/4430499568/"),
    );

    const request = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(request).toMatchObject({
      include: ["web_search_call.action.sources"],
      model: "gpt-5.6-luna",
      store: false,
      tool_choice: "required",
      tools: [{ type: "web_search" }],
    });
    expect(request.input[1].content).toContain("LinkedIn job ID 4430499568");
    expect(result).toEqual({
      canonicalUrl: "https://www.linkedin.com/jobs/view/4430499568/",
      citations: ["https://www.linkedin.com/jobs/view/4430499568/"],
      draft: {
        description:
          "Build reliable production AI systems and collaborate across distributed engineering teams.",
        location: "Nice, France",
        title: "Senior Software Engineer - AI (EMEA)",
      },
    });
  });

  it("keeps non-LinkedIn searches scoped to the submitted domain", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      json: async () => ({
        output: [
          {
            action: {
              type: "open_page",
              url: "https://jobs.example.com/roles/123",
            },
            type: "web_search_call",
          },
        ],
        output_text: JSON.stringify({
          description:
            "Build and maintain the product with a multidisciplinary engineering team.",
          location: "Remote",
          sourceUrl: "https://jobs.example.com/roles/123",
          title: "Product Engineer",
        }),
      }),
      ok: true,
      status: 200,
    });
    const search = createOpenAIRoleIntakeIndexedSearch({
      apiKey: "sk-test",
      fetcher,
      model: "gpt-5.6-luna",
      timeoutMs: 5_000,
    });

    await search(new URL("https://jobs.example.com/roles/123"));

    const request = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(request.tools).toEqual([
      {
        filters: { allowed_domains: ["jobs.example.com"] },
        type: "web_search",
      },
    ]);
  });

  it("accepts an exact page opened by the search tool as source evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      json: async () => ({
        output: [
          {
            action: {
              type: "open_page",
              url: "https://fr.indeed.com/viewjob?jk=f066959d3108e72b",
            },
            type: "web_search_call",
          },
        ],
        output_text: JSON.stringify({
          description:
            "Develop and maintain Talend data integrations, document changes, and support production workflows.",
          location: "Paris, France",
          sourceUrl: "https://fr.indeed.com/viewjob?jk=f066959d3108e72b",
          title: "Développeur Talend H.F",
        }),
      }),
      ok: true,
      status: 200,
    });
    const search = createOpenAIRoleIntakeIndexedSearch({
      apiKey: "sk-test",
      fetcher,
      model: "gpt-5.6-luna",
      timeoutMs: 5_000,
    });

    await expect(
      search(new URL("https://fr.indeed.com/viewjob?jk=f066959d3108e72b")),
    ).resolves.toMatchObject({
      canonicalUrl: "https://fr.indeed.com/viewjob?jk=f066959d3108e72b",
    });
  });

  it("fails closed when search did not consult the submitted job", async () => {
    const search = createOpenAIRoleIntakeIndexedSearch({
      apiKey: "sk-test",
      fetcher: vi.fn().mockResolvedValue({
        json: async () => ({
          output: [
            {
              action: {
                sources: [
                  {
                    title: "Different job",
                    url: "https://www.linkedin.com/jobs/view/9999999999/",
                  },
                ],
              },
              type: "web_search_call",
            },
          ],
          output_text: JSON.stringify({
            canonicalUrl: "https://www.linkedin.com/jobs/view/9999999999/",
            description:
              "A plausible but unrelated job description that must not be accepted.",
            location: "Paris",
            sourceUrl: "https://www.linkedin.com/jobs/view/9999999999/",
            title: "Different job",
          }),
        }),
        ok: true,
        status: 200,
      }),
      model: "gpt-5.6-luna",
      timeoutMs: 5_000,
    });

    await expect(
      search(new URL("https://www.linkedin.com/jobs/view/4430499568/")),
    ).rejects.toMatchObject({ code: "indexed_search_unverified" });
  });

  it("maps provider and malformed payload failures to stable errors", async () => {
    const unavailable = createOpenAIRoleIntakeIndexedSearch({
      apiKey: "sk-test",
      fetcher: vi.fn().mockResolvedValue({
        json: async () => ({}),
        ok: false,
        status: 429,
      }),
      model: "gpt-5.6-luna",
      timeoutMs: 5_000,
    });
    const malformed = createOpenAIRoleIntakeIndexedSearch({
      apiKey: "sk-test",
      fetcher: vi.fn().mockResolvedValue({
        json: async () => ({ output: [], output_text: "not-json" }),
        ok: true,
        status: 200,
      }),
      model: "gpt-5.6-luna",
      timeoutMs: 5_000,
    });

    await expect(
      unavailable(new URL("https://www.indeed.com/viewjob?jk=abc")),
    ).rejects.toMatchObject({
      code: "indexed_search_unavailable",
      retryable: true,
    });
    await expect(
      malformed(new URL("https://www.indeed.com/viewjob?jk=abc")),
    ).rejects.toMatchObject({ code: "indexed_search_invalid" });
  });
});
