import { describe, expect, it } from "vitest";

import { resolveRoleIntakeAtsSource } from "./role-intake-ats-api";

function resolve(url: string) {
  return resolveRoleIntakeAtsSource(new URL(url));
}

describe("resolveRoleIntakeAtsSource", () => {
  it("ignores a URL that is not a hosted ATS board", () => {
    expect(resolve("https://www.hellowork.com/fr-fr/emplois/82054407.html")).toBeNull();
    expect(resolve("https://careers.example.com/jobs/42")).toBeNull();
  });

  it("keeps a regional board on its own regional API", () => {
    expect(resolve("https://job-boards.greenhouse.io/acme/jobs/123")?.apiUrl.toString()).toBe(
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
    );
    expect(resolve("https://job-boards.eu.greenhouse.io/acme/jobs/123")?.apiUrl.toString()).toBe(
      "https://boards-api.eu.greenhouse.io/v1/boards/acme/jobs/123",
    );
  });

  // Segments are interpolated into an API URL, so a traversal attempt must not
  // resolve at all rather than be escaped into a different endpoint.
  it("rejects path segments that are not plain identifiers", () => {
    expect(resolve("https://job-boards.greenhouse.io/..%2F..%2Fadmin/jobs/1")).toBeNull();
    expect(resolve("https://job-boards.greenhouse.io/acme/jobs/not-a-number")).toBeNull();
    expect(resolve("https://jobs.lever.co/acme/short")).toBeNull();
    expect(resolve("https://job-boards.greenhouse.io/acme/jobs")).toBeNull();
    expect(resolve("https://job-boards.greenhouse.io/acme/postings/123")).toBeNull();
  });

  it("reads a Greenhouse posting whose markup arrives escaped", () => {
    const source = resolve("https://job-boards.greenhouse.io/acme/jobs/123");

    expect(
      source?.mapPayload({
        absolute_url: "https://job-boards.greenhouse.io/acme/jobs/123",
        content:
          "&lt;p&gt;We are hiring a staff engineer to own our billing platform.&lt;/p&gt;",
        location: { name: "Paris, France" },
        title: "Staff Engineer",
      }),
    ).toEqual({
      canonicalUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
      draft: {
        description: "We are hiring a staff engineer to own our billing platform.",
        location: "Paris, France",
        title: "Staff Engineer",
      },
    });
  });

  // Lever splits one posting across an intro, titled sections and a closing
  // block; only the concatenation is the description the recruiter wrote.
  it("joins every Lever section into a single description", () => {
    const source = resolve(
      "https://jobs.lever.co/acme/33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
    );

    expect(source?.apiUrl.toString()).toBe(
      "https://api.lever.co/v0/postings/acme/33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
    );
    expect(
      source?.mapPayload({
        additional: "<p>We interview in French and English.</p>",
        categories: { allLocations: ["Lyon"], location: "Lyon, France" },
        description: "<div>Join the platform team building our payments core.</div>",
        hostedUrl: "https://jobs.lever.co/acme/33538a2f-d27d-4a96-8f05-fa4b0e4d940e",
        lists: [{ content: "<li>Six years of backend work</li>", text: "Requirements" }],
        text: "Backend Engineer",
      })?.draft.description,
    ).toBe(
      "Join the platform team building our payments core.\n\nRequirements\nSix years of backend work\n\nWe interview in French and English.",
    );
  });

  it("selects the requested posting out of an Ashby board", () => {
    const source = resolve(
      "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    );

    expect(source?.apiUrl.toString()).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/acme",
    );
    expect(
      source?.mapPayload({
        jobs: [
          { descriptionHtml: "<p>Another role entirely.</p>", id: "other", title: "Designer" },
          {
            descriptionHtml: "<p>Own the data platform end to end for our EU customers.</p>",
            id: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
            jobUrl: "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
            location: "Remote - European Union",
            title: "Data Engineer",
          },
        ],
      }),
    ).toEqual({
      canonicalUrl: "https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
      draft: {
        description: "Own the data platform end to end for our EU customers.",
        location: "Remote - European Union",
        title: "Data Engineer",
      },
    });
  });

  // A payload the mapper cannot read must not become an empty draft: returning
  // null is what lets the importer fall through to the page path.
  it("returns null when the payload carries no usable posting", () => {
    const greenhouse = resolve("https://job-boards.greenhouse.io/acme/jobs/123");
    expect(greenhouse?.mapPayload({ title: "Staff Engineer" })).toBeNull();
    expect(greenhouse?.mapPayload("not an object")).toBeNull();

    const ashby = resolve("https://jobs.ashbyhq.com/acme/7458d4e9-da2e-47bd-98cb-adfda43d42b2");
    expect(ashby?.mapPayload({ jobs: [{ id: "someone-else" }] })).toBeNull();
  });
});
