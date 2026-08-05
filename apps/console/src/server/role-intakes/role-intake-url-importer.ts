import { promises as dns } from "node:dns";
import https from "node:https";

import type {
  ImportedRoleDraft,
  RoleIntakeAcquisitionStrategy,
  RoleIntakeWarning,
} from "@prelude/contracts";

import {
  assertRoleIntakeSourceSupported,
  getRoleIntakeUrlAcquisitionStrategy,
  isGloballyRoutableIpAddress,
  normalizeRoleIntakeUrl,
  RoleIntakeUrlImportError,
} from "./role-intake-url-policy";
import {
  createRoleIntakeIndexedSearchFromEnv,
  type RoleIntakeIndexedSearch,
} from "./role-intake-indexed-search";
import {
  buildMissingFieldWarnings,
  extractRoleIntakeUrlDraft,
  MIN_ROLE_DESCRIPTION_CHARACTERS,
  type RoleIntakeUrlFieldSources,
} from "./role-intake-url-extractor";
import {
  resolveRoleIntakeAtsSource,
  type RoleIntakeAtsSource,
} from "./role-intake-ats-api";

export {
  assertRoleIntakeSourceSupported,
  createRoleIntakeUrlIdentity,
  getRoleIntakeUrlAcquisitionStrategy,
  isGloballyRoutableIpAddress,
  normalizeRoleIntakeUrl,
  RoleIntakeUrlImportError,
} from "./role-intake-url-policy";
export {
  extractRoleIntakeUrlDraft,
  type RoleIntakeFieldSource,
  type RoleIntakeUrlFieldSources,
} from "./role-intake-url-extractor";

// Keep the established crawler token stable across the product rebrand so
// existing robots.txt allowlists continue to work.
const IMPORTER_USER_AGENT = "PreludeRoleImporter/1.0";
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const EXTRACTOR_VERSION = "static-html-v1";
const INDEXED_SEARCH_EXTRACTOR_VERSION = "indexed-web-search-v1";
const ATS_API_EXTRACTOR_VERSION = "ats-api-v1";
const INDEXED_SEARCH_FALLBACK_ERRORS = new Set([
  "no_usable_text",
  "remote_unavailable",
  "response_too_large",
  "robots_disallowed",
  "robots_unavailable",
  "source_not_public",
  "unsupported_content",
]);

export type RoleIntakePublicPage = {
  acquisitionStrategy: RoleIntakeAcquisitionStrategy;
  canonicalUrl: string;
  citationUrls: string[];
  draft: ImportedRoleDraft;
  extractorVersion: string;
  fetchedAt: Date;
  fieldSources: RoleIntakeUrlFieldSources;
  sourceHost: string;
  warnings: RoleIntakeWarning[];
};

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type RoleIntakeUrlRequest = {
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  maxBytes: number;
  url: string;
};

type RoleIntakeUrlResponse = {
  body: string;
  headers: Record<string, string | undefined>;
  statusCode: number;
};

export type RoleIntakeUrlImporterDependencies = {
  indexedSearch?: RoleIntakeIndexedSearch | null;
  now?: () => Date;
  request?: (input: RoleIntakeUrlRequest) => Promise<RoleIntakeUrlResponse>;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
};

// Node enables multi-address lookup for TLS requests; preserve the pinned IP in
// both callback shapes rather than allowing a fallback DNS resolution.
export function getPinnedLookupResult(
  address: string,
  family: 4 | 6,
  all: true,
): Array<{ address: string; family: 4 | 6 }>;
export function getPinnedLookupResult(
  address: string,
  family: 4 | 6,
  all: false,
): string;
export function getPinnedLookupResult(
  address: string,
  family: 4 | 6,
  all: boolean,
) {
  return all ? [{ address, family }] : address;
}

/**
 * Fetches a public role page with a pinned DNS destination, no cookie state,
 * bounded redirects and response sizes, and robots policy enforcement.
 */
export async function fetchRoleIntakePublicPage(
  source: string,
  dependencies: RoleIntakeUrlImporterDependencies = {},
): Promise<RoleIntakePublicPage> {
  const request = dependencies.request ?? requestPinnedHttps;
  const resolve = dependencies.resolve ?? resolvePublicHostname;
  const now = dependencies.now ?? (() => new Date());
  const indexedSearch =
    dependencies.indexedSearch === undefined
      ? createRoleIntakeIndexedSearchFromEnv()
      : dependencies.indexedSearch;
  let url = normalizeRoleIntakeUrl(source);
  assertRoleIntakeSourceSupported(url);

  if (getRoleIntakeUrlAcquisitionStrategy(url) === "indexed_search") {
    return fetchIndexedRoleIntakePublicPage(url, indexedSearch, now);
  }

  // A hosted ATS board answers with the posting itself, so it is preferred over
  // reading the same content back out of the page. Any failure here is not
  // terminal: the page path below still applies.
  const atsSource = resolveRoleIntakeAtsSource(url);
  if (atsSource) {
    const page = await fetchAtsRoleIntakePublicPage(url, atsSource, {
      now,
      request,
      resolve,
    });
    if (page) {
      return page;
    }
  }

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertRobotsAllows(url, { request, resolve });

      const response = await requestPublicUrl(url, {
        accept: "text/html,application/xhtml+xml;q=0.9",
        request,
        resolve,
      });
      if (isRedirect(response.statusCode)) {
        if (redirects === MAX_REDIRECTS) {
          throw new RoleIntakeUrlImportError(
            "redirect_limit",
            "The public job page redirected too many times. Start from a manual brief instead.",
          );
        }
        const location = response.headers.location;
        if (!location) {
          throw new RoleIntakeUrlImportError(
            "remote_unavailable",
            "The public job page returned an incomplete redirect. Start from a manual brief instead.",
          );
        }
        try {
          url = normalizeRoleIntakeUrl(new URL(location, url).toString());
        } catch (error) {
          if (error instanceof RoleIntakeUrlImportError) {
            throw error;
          }
          throw new RoleIntakeUrlImportError(
            "remote_unavailable",
            "The public job page returned an invalid redirect. Start from a manual brief instead.",
          );
        }
        assertRoleIntakeSourceSupported(url);
        if (getRoleIntakeUrlAcquisitionStrategy(url) === "indexed_search") {
          return fetchIndexedRoleIntakePublicPage(url, indexedSearch, now);
        }
        continue;
      }

      if (response.statusCode === 401 || response.statusCode === 403) {
        throw new RoleIntakeUrlImportError(
          "source_not_public",
          "HireCall can only import a job page that is publicly available without sign-in.",
        );
      }
      if (response.statusCode >= 500) {
        throw new RoleIntakeUrlImportError(
          "remote_unavailable",
          "The public job page is temporarily unavailable. Please retry or start from a manual brief.",
          true,
        );
      }
      if (response.statusCode !== 200) {
        throw new RoleIntakeUrlImportError(
          "source_not_public",
          "HireCall could not access a public job page at this URL. Start from a manual brief instead.",
        );
      }
      if (!isHtmlContentType(response.headers["content-type"])) {
        throw new RoleIntakeUrlImportError(
          "unsupported_content",
          "HireCall can import public HTML job pages only. Start from a manual brief instead.",
        );
      }
      if (!isIdentityEncoding(response.headers["content-encoding"])) {
        throw new RoleIntakeUrlImportError(
          "unsupported_content",
          "HireCall could not read this job page safely. Start from a manual brief instead.",
        );
      }

      const extraction = extractRoleIntakeUrlDraft(response.body);
      return {
        acquisitionStrategy: "direct_html",
        canonicalUrl: url.toString(),
        citationUrls: [url.toString()],
        draft: extraction.draft,
        extractorVersion: EXTRACTOR_VERSION,
        fetchedAt: now(),
        fieldSources: extraction.fieldSources,
        sourceHost: url.hostname,
        warnings: extraction.warnings,
      };
    }
  } catch (error) {
    if (
      indexedSearch &&
      error instanceof RoleIntakeUrlImportError &&
      shouldTryIndexedSearch(error)
    ) {
      return fetchIndexedRoleIntakePublicPage(url, indexedSearch, now);
    }
    throw error;
  }

  throw new RoleIntakeUrlImportError(
    "redirect_limit",
    "The public job page redirected too many times. Start from a manual brief instead.",
  );
}

/**
 * Reads a posting from its ATS API. Returns null instead of throwing whenever
 * the API is unavailable or answers something unusable, so a provider outage
 * degrades to the page path rather than failing the import.
 *
 * No robots check runs here, unlike the page path. RFC 9309 governs crawling a
 * site's pages, and these are documented JSON APIs meant for programmatic use;
 * the host is one of a fixed set built into `resolveRoleIntakeAtsSource` rather
 * than anything the recruiter supplies, so there is no crawl surface and no
 * SSRF surface to police. Measured 2026-08-05: Greenhouse and Lever allow these
 * paths anyway, and Ashby answers 401 for `/robots.txt`, which the page-path
 * rule would treat as a refusal.
 */
async function fetchAtsRoleIntakePublicPage(
  source: URL,
  ats: RoleIntakeAtsSource,
  dependencies: {
    now: () => Date;
    request: NonNullable<RoleIntakeUrlImporterDependencies["request"]>;
    resolve: NonNullable<RoleIntakeUrlImporterDependencies["resolve"]>;
  },
): Promise<RoleIntakePublicPage | null> {
  let response: RoleIntakeUrlResponse;
  try {
    response = await requestPublicUrl(ats.apiUrl, {
      accept: "application/json",
      maxBytes: ats.maxResponseBytes,
      request: dependencies.request,
      resolve: dependencies.resolve,
    });
  } catch {
    return null;
  }
  if (
    response.statusCode !== 200 ||
    normaliseContentType(response.headers["content-type"]) !==
      "application/json"
  ) {
    return null;
  }

  let posting: ReturnType<RoleIntakeAtsSource["mapPayload"]>;
  try {
    posting = ats.mapPayload(JSON.parse(response.body));
  } catch {
    return null;
  }
  if (
    !posting ||
    posting.draft.description.length < MIN_ROLE_DESCRIPTION_CHARACTERS
  ) {
    return null;
  }

  const canonicalUrl = safeNormalizeUrl(posting.canonicalUrl) ?? source;
  return {
    acquisitionStrategy: "ats_api",
    canonicalUrl: canonicalUrl.toString(),
    citationUrls: [...new Set([canonicalUrl.toString(), source.toString()])],
    draft: posting.draft,
    extractorVersion: `${ATS_API_EXTRACTOR_VERSION}:${ats.platform}`,
    fetchedAt: dependencies.now(),
    fieldSources: {
      description: "ats_public_api",
      location: posting.draft.location ? "ats_public_api" : "unavailable",
      title: posting.draft.title ? "ats_public_api" : "unavailable",
    },
    sourceHost: canonicalUrl.hostname,
    warnings: buildMissingFieldWarnings(posting.draft),
  };
}

function safeNormalizeUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }
  try {
    return normalizeRoleIntakeUrl(value);
  } catch {
    return null;
  }
}

async function fetchIndexedRoleIntakePublicPage(
  source: URL,
  indexedSearch: RoleIntakeIndexedSearch | null,
  now: () => Date,
): Promise<RoleIntakePublicPage> {
  if (!indexedSearch) {
    throw new RoleIntakeUrlImportError(
      "indexed_search_unavailable",
      "HireCall cannot search this job source right now. Continue manually with the same link.",
    );
  }
  const result = await indexedSearch(source);
  const canonicalUrl = normalizeRoleIntakeUrl(result.canonicalUrl);
  const citationUrls = result.citations.flatMap((value) => {
    const citation = safeNormalizeUrl(value);
    return citation ? [citation.toString()] : [];
  });
  const fieldSources: RoleIntakeUrlFieldSources = {
    description: "indexed_web_search",
    location: result.draft.location ? "indexed_web_search" : "unavailable",
    title: result.draft.title ? "indexed_web_search" : "unavailable",
  };

  return {
    acquisitionStrategy: "indexed_search",
    canonicalUrl: canonicalUrl.toString(),
    citationUrls: [...new Set(citationUrls)],
    draft: result.draft,
    extractorVersion: INDEXED_SEARCH_EXTRACTOR_VERSION,
    fetchedAt: now(),
    fieldSources,
    sourceHost: canonicalUrl.hostname,
    warnings: [
      {
        code: "indexed_source_review_required",
        message:
          "This draft comes from an indexed public source. Confirm every field against the linked job page before continuing.",
      },
    ],
  };
}

function shouldTryIndexedSearch(error: RoleIntakeUrlImportError): boolean {
  return INDEXED_SEARCH_FALLBACK_ERRORS.has(error.code);
}

async function assertRobotsAllows(
  source: URL,
  dependencies: Pick<
    RoleIntakeUrlImporterDependencies,
    "request" | "resolve"
  > & {
    request: NonNullable<RoleIntakeUrlImporterDependencies["request"]>;
    resolve: NonNullable<RoleIntakeUrlImporterDependencies["resolve"]>;
  },
): Promise<void> {
  const robotsUrl = new URL("/robots.txt", source.origin);
  const response = await requestPublicUrl(robotsUrl, {
    accept: "text/plain;q=0.9,*/*;q=0.1",
    request: dependencies.request,
    resolve: dependencies.resolve,
  });
  if (response.statusCode === 404) {
    return;
  }
  if (
    response.statusCode !== 200 ||
    !isTextContentType(response.headers["content-type"])
  ) {
    throw new RoleIntakeUrlImportError(
      "robots_unavailable",
      "HireCall could not verify the source site policy. Start from a manual brief instead.",
    );
  }
  if (!robotsAllowPath(response.body, `${source.pathname}${source.search}`)) {
    throw new RoleIntakeUrlImportError(
      "robots_disallowed",
      "This source site does not allow HireCall to import this job page. Start from a manual brief instead.",
    );
  }
}

async function requestPublicUrl(
  url: URL,
  dependencies: {
    accept: string;
    maxBytes?: number;
    request: NonNullable<RoleIntakeUrlImporterDependencies["request"]>;
    resolve: NonNullable<RoleIntakeUrlImporterDependencies["resolve"]>;
  },
): Promise<RoleIntakeUrlResponse> {
  const addresses = await dependencies.resolve(url.hostname);
  if (
    !addresses.length ||
    addresses.some((address) => !isGloballyRoutableIpAddress(address.address))
  ) {
    throw new RoleIntakeUrlImportError(
      "private_destination",
      "HireCall can only import public job pages.",
    );
  }
  const address =
    addresses.find((candidate) => candidate.family === 4) ?? addresses[0]!;
  try {
    return await dependencies.request({
      address: address.address,
      family: address.family,
      headers: {
        accept: dependencies.accept,
        "accept-encoding": "identity",
        "user-agent": IMPORTER_USER_AGENT,
      },
      maxBytes: dependencies.maxBytes ?? MAX_RESPONSE_BYTES,
      url: url.toString(),
    });
  } catch (error) {
    if (error instanceof RoleIntakeUrlImportError) {
      throw error;
    }
    throw new RoleIntakeUrlImportError(
      "remote_unavailable",
      "The public job page is temporarily unavailable. Please retry or start from a manual brief.",
      true,
    );
  }
}

async function resolvePublicHostname(
  hostname: string,
): Promise<ResolvedAddress[]> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((address) =>
    address.family === 4 || address.family === 6
      ? [{ address: address.address, family: address.family }]
      : [],
  );
}

/**
 * The custom lookup pins the validated address into the actual TLS request.
 * A standalone DNS check would leave a TOCTOU window for DNS rebinding.
 * Source: OWASP SSRF Prevention Cheat Sheet and Node HTTPS request options.
 */
async function requestPinnedHttps(
  input: RoleIntakeUrlRequest,
): Promise<RoleIntakeUrlResponse> {
  const url = new URL(input.url);
  return new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const request = https.request(
      {
        headers: input.headers,
        hostname: url.hostname,
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(
              null,
              getPinnedLookupResult(input.address, input.family, true),
            );
            return;
          }
          callback(
            null,
            getPinnedLookupResult(input.address, input.family, false),
            input.family,
          );
        },
        method: "GET",
        path: `${url.pathname}${url.search}`,
        port: 443,
        rejectUnauthorized: true,
        servername: url.hostname,
        signal: timeout,
      },
      (response) => {
        const headerBytes = response.rawHeaders.reduce(
          (total, value) => total + Buffer.byteLength(value),
          0,
        );
        if (headerBytes > MAX_RESPONSE_HEADER_BYTES) {
          request.destroy();
          reject(
            new RoleIntakeUrlImportError(
              "response_too_large",
              "The public job page returned too much response metadata. Start from a manual brief instead.",
            ),
          );
          return;
        }
        const declaredLength = Number(
          response.headers["content-length"] ?? "0",
        );
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > input.maxBytes
        ) {
          request.destroy();
          reject(
            new RoleIntakeUrlImportError(
              "response_too_large",
              "The public job page is too large to import. Start from a manual brief instead.",
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on("data", (chunk: Buffer) => {
          byteLength += chunk.length;
          if (byteLength > input.maxBytes) {
            request.destroy(
              new RoleIntakeUrlImportError(
                "response_too_large",
                "The public job page is too large to import. Start from a manual brief instead.",
              ),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.once("error", reject);
        response.once("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: normaliseHeaders(response.headers),
            statusCode: response.statusCode ?? 0,
          });
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Role intake request timed out."));
    });
    request.end();
  });
}

function isRedirect(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function isHtmlContentType(value: string | undefined): boolean {
  const contentType = normaliseContentType(value);
  return contentType === "text/html" || contentType === "application/xhtml+xml";
}

function isTextContentType(value: string | undefined): boolean {
  return normaliseContentType(value) === "text/plain";
}

function isIdentityEncoding(value: string | undefined): boolean {
  return !value || normaliseContentType(value) === "identity";
}

function normaliseContentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function normaliseHeaders(
  headers: NodeJS.Dict<string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
}

function robotsAllowPath(content: string, target: string): boolean {
  const groups = parseRobots(content);
  const exactGroups = groups.filter((group) =>
    group.agents.includes("preluderoleimporter"),
  );
  const matchingGroups = exactGroups.length
    ? exactGroups
    : groups.filter((group) => group.agents.includes("*"));
  const matches = matchingGroups.flatMap((group) =>
    group.rules
      .filter((rule) => robotRuleMatches(target, rule.path))
      .map((rule) => ({
        ...rule,
        length: rule.path.replaceAll("*", "").replaceAll("$", "").length,
      })),
  );
  if (!matches.length) {
    return true;
  }
  const mostSpecific = Math.max(...matches.map((rule) => rule.length));
  return matches.some(
    (rule) => rule.length === mostSpecific && rule.kind === "allow",
  );
}

function parseRobots(content: string): Array<{
  agents: string[];
  rules: Array<{ kind: "allow" | "disallow"; path: string }>;
}> {
  const groups: Array<{
    agents: string[];
    rules: Array<{ kind: "allow" | "disallow"; path: string }>;
  }> = [];
  let current: (typeof groups)[number] | null = null;
  for (const sourceLine of content.split(/\r?\n/)) {
    const line = sourceLine.split("#", 1)[0]?.trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent" && value) {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (
      current &&
      (field === "allow" || field === "disallow") &&
      value &&
      value.startsWith("/")
    ) {
      current.rules.push({ kind: field, path: value });
    }
  }
  return groups;
}

function robotRuleMatches(target: string, path: string): boolean {
  const escaped = path
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replace(/\$$/, "$");
  return new RegExp(`^${escaped}`).test(target);
}
