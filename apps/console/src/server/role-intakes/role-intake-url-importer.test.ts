import { describe, expect, it, vi } from "vitest";

import {
  RoleIntakeUrlImportError,
  extractRoleIntakeUrlDraft,
  fetchRoleIntakePublicPage,
  getPinnedLookupResult,
  isGloballyRoutableIpAddress,
  normalizeRoleIntakeUrl,
} from "./role-intake-url-importer";

describe("role intake public URL policy", () => {
  it("normalizes a public HTTPS job URL without persisting fragments or tracking", () => {
    expect(
      normalizeRoleIntakeUrl(
        " https://careers.example.com/jobs/123?utm_source=newsletter&jobId=123#details ",
      ).toString(),
    ).toBe("https://careers.example.com/jobs/123?jobId=123");
  });

  it.each([
    "http://careers.example.com/jobs/123",
    "https://user:password@careers.example.com/jobs/123",
    "https://127.0.0.1/jobs/123",
    "https://[::1]/jobs/123",
    "https://careers.example.com:8443/jobs/123",
    "https://careers.example.com/jobs/123?token=private",
  ])("rejects an unsafe or non-public source URL: %s", (value) => {
    expect(() => normalizeRoleIntakeUrl(value)).toThrow(RoleIntakeUrlImportError);
  });

  it.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["100.64.0.1", false],
    ["169.254.169.254", false],
    ["192.168.1.1", false],
    ["198.51.100.10", false],
    ["224.0.0.1", false],
    ["2606:4700:4700::1111", true],
    ["::1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["2001:db8::1", false],
    ["::ffff:127.0.0.1", false],
  ])("classifies %s without treating special-purpose space as public", (address, expected) => {
    expect(isGloballyRoutableIpAddress(address)).toBe(expected);
  });
});

describe("role intake public URL fetch", () => {
  it("returns the multi-address lookup shape required by Node TLS", () => {
    expect(getPinnedLookupResult("8.8.8.8", 4, true)).toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(getPinnedLookupResult("8.8.8.8", 4, false)).toBe("8.8.8.8");
  });

  it("pins a validated address and checks robots before parsing one job page", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        body: "User-agent: PreludeRoleImporter\nAllow: /jobs/",
        headers: { "content-type": "text/plain" },
        statusCode: 200,
      })
      .mockResolvedValueOnce({
        body: `
          <html><head><title>Ignored page title</title>
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"JobPosting","title":"Senior Product Designer","description":"<p>Own product discovery and delivery across a B2B workflow.</p>","jobLocation":{"address":{"addressLocality":"Paris"}}}
          </script></head><body><script>window.secret = 'never extracted'</script><main>Fallback body</main></body></html>
        `,
        headers: { "content-type": "text/html; charset=utf-8" },
        statusCode: 200,
      });
    const resolve = vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);

    const result = await fetchRoleIntakePublicPage("https://careers.example.com/jobs/123", {
      resolve,
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: "8.8.8.8",
        headers: expect.objectContaining({ "accept-encoding": "identity" }),
        url: "https://careers.example.com/robots.txt",
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: "8.8.8.8",
        headers: expect.not.objectContaining({ authorization: expect.anything() }),
        url: "https://careers.example.com/jobs/123",
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result.canonicalUrl).toBe("https://careers.example.com/jobs/123");
    expect(result.draft).toEqual({
      description: "Own product discovery and delivery across a B2B workflow.",
      location: "Paris",
      title: "Senior Product Designer",
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("never extracted");
  });

  it("rejects a mixed public/private DNS answer before any request is sent", async () => {
    const request = vi.fn();

    await expect(
      fetchRoleIntakePublicPage("https://careers.example.com/jobs/123", {
        resolve: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ],
        request,
      }),
    ).rejects.toMatchObject({ code: "private_destination" });
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates each redirect and refuses a blocked provider before requesting it", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        body: "User-agent: PreludeRoleImporter\nAllow: /",
        headers: { "content-type": "text/plain" },
        statusCode: 200,
      })
      .mockResolvedValueOnce({
        body: "",
        headers: { location: "https://www.linkedin.com/jobs/view/123" },
        statusCode: 302,
      });

    await expect(
      fetchRoleIntakePublicPage("https://careers.example.com/jobs/123", {
        resolve: async () => [{ address: "8.8.8.8", family: 4 }],
        request,
      }),
    ).rejects.toMatchObject({ code: "provider_blocked" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("honors a robots denial and gives a manual fallback error", async () => {
    await expect(
      fetchRoleIntakePublicPage("https://careers.example.com/jobs/123", {
        resolve: async () => [{ address: "8.8.8.8", family: 4 }],
        request: async () => ({
          body: "User-agent: PreludeRoleImporter\nDisallow: /jobs/",
          headers: { "content-type": "text/plain" },
          statusCode: 200,
        }),
      }),
    ).rejects.toMatchObject({ code: "robots_disallowed" });
  });
});

describe("role intake static HTML extraction", () => {
  it("uses bounded visible main content when JobPosting JSON-LD is unavailable", () => {
    const result = extractRoleIntakeUrlDraft(`
      <html><head><title>Customer Success Manager | Acme</title></head>
      <body><nav>Pricing Support Sign in</nav><main><h1>Customer Success Manager</h1>
      <p>Own onboarding, customer retention, and customer feedback workflows across our growing B2B product.</p>
      <p>Partner with product and support teams to unblock customer outcomes.</p></main><footer>Privacy</footer></body></html>
    `);

    expect(result.draft.title).toBe("Customer Success Manager");
    expect(result.draft.description).toContain("Own onboarding");
    expect(result.draft.description).not.toContain("Pricing Support Sign in");
    expect(result.fieldSources).toEqual({
      description: "main_content",
      location: "unavailable",
      title: "heading",
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "location_unavailable" }),
      ]),
    );
  });

  it("never treats scripts, forms, or challenge pages as usable job text", () => {
    expect(() =>
      extractRoleIntakeUrlDraft(`
        <html><head><title>Please wait</title><script>document.cookie = 'secret'</script></head>
        <body><form><input type="password" /><button>Sign in</button></form></body></html>
      `),
    ).toThrow(expect.objectContaining({ code: "no_usable_text" }));
  });
});
