import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import https from "node:https";

import type { ImportedRoleDraft, RoleIntakeWarning } from "@prelude/contracts";

import {
  assertProviderAllowed,
  isGloballyRoutableIpAddress,
  normalizeRoleIntakeUrl,
  RoleIntakeUrlImportError,
} from "./role-intake-url-policy";
import {
  extractRoleIntakeUrlDraft,
  type RoleIntakeUrlFieldSources,
} from "./role-intake-url-extractor";

export {
  createRoleIntakeUrlIdentity,
  isGloballyRoutableIpAddress,
  normalizeRoleIntakeUrl,
  RoleIntakeUrlImportError,
} from "./role-intake-url-policy";
export {
  extractRoleIntakeUrlDraft,
  type RoleIntakeFieldSource,
  type RoleIntakeUrlFieldSources,
} from "./role-intake-url-extractor";

const IMPORTER_USER_AGENT = "PreludeRoleImporter/1.0";
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const EXTRACTOR_VERSION = "static-html-v1";

export type RoleIntakePublicPage = {
  canonicalUrl: string;
  contentHash: string;
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
export function getPinnedLookupResult(address: string, family: 4 | 6, all: false): string;
export function getPinnedLookupResult(address: string, family: 4 | 6, all: boolean) {
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
  let url = normalizeRoleIntakeUrl(source);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    assertProviderAllowed(url.hostname);
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
      continue;
    }

    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new RoleIntakeUrlImportError(
        "source_not_public",
        "Prelude can only import a job page that is publicly available without sign-in.",
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
        "Prelude could not access a public job page at this URL. Start from a manual brief instead.",
      );
    }
    if (!isHtmlContentType(response.headers["content-type"])) {
      throw new RoleIntakeUrlImportError(
        "unsupported_content",
        "Prelude can import public HTML job pages only. Start from a manual brief instead.",
      );
    }
    if (!isIdentityEncoding(response.headers["content-encoding"])) {
      throw new RoleIntakeUrlImportError(
        "unsupported_content",
        "Prelude could not read this job page safely. Start from a manual brief instead.",
      );
    }

    const extraction = extractRoleIntakeUrlDraft(response.body);
    return {
      canonicalUrl: url.toString(),
      contentHash: createHash("sha256").update(response.body).digest("hex"),
      draft: extraction.draft,
      extractorVersion: EXTRACTOR_VERSION,
      fetchedAt: now(),
      fieldSources: extraction.fieldSources,
      sourceHost: url.hostname,
      warnings: extraction.warnings,
    };
  }

  throw new RoleIntakeUrlImportError(
    "redirect_limit",
    "The public job page redirected too many times. Start from a manual brief instead.",
  );
}

async function assertRobotsAllows(
  source: URL,
  dependencies: Pick<RoleIntakeUrlImporterDependencies, "request" | "resolve"> & {
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
  if (response.statusCode !== 200 || !isTextContentType(response.headers["content-type"])) {
    throw new RoleIntakeUrlImportError(
      "robots_unavailable",
      "Prelude could not verify the source site policy. Start from a manual brief instead.",
    );
  }
  if (!robotsAllowPath(response.body, `${source.pathname}${source.search}`)) {
    throw new RoleIntakeUrlImportError(
      "robots_disallowed",
      "This source site does not allow Prelude to import this job page. Start from a manual brief instead.",
    );
  }
}

async function requestPublicUrl(
  url: URL,
  dependencies: {
    accept: string;
    request: NonNullable<RoleIntakeUrlImporterDependencies["request"]>;
    resolve: NonNullable<RoleIntakeUrlImporterDependencies["resolve"]>;
  },
): Promise<RoleIntakeUrlResponse> {
  const addresses = await dependencies.resolve(url.hostname);
  if (!addresses.length || addresses.some((address) => !isGloballyRoutableIpAddress(address.address))) {
    throw new RoleIntakeUrlImportError(
      "private_destination",
      "Prelude can only import public job pages.",
    );
  }
  const address = addresses.find((candidate) => candidate.family === 4) ?? addresses[0]!;
  try {
    return await dependencies.request({
      address: address.address,
      family: address.family,
      headers: {
        accept: dependencies.accept,
        "accept-encoding": "identity",
        "user-agent": IMPORTER_USER_AGENT,
      },
      maxBytes: MAX_RESPONSE_BYTES,
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

async function resolvePublicHostname(hostname: string): Promise<ResolvedAddress[]> {
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
async function requestPinnedHttps(input: RoleIntakeUrlRequest): Promise<RoleIntakeUrlResponse> {
  const url = new URL(input.url);
  return new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const request = https.request(
      {
        headers: input.headers,
        hostname: url.hostname,
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, getPinnedLookupResult(input.address, input.family, true));
            return;
          }
          callback(null, getPinnedLookupResult(input.address, input.family, false), input.family);
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
        const declaredLength = Number(response.headers["content-length"] ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
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
  const exactGroups = groups.filter((group) => group.agents.includes("preluderoleimporter"));
  const matchingGroups = exactGroups.length
    ? exactGroups
    : groups.filter((group) => group.agents.includes("*"));
  const matches = matchingGroups.flatMap((group) =>
    group.rules
      .filter((rule) => robotRuleMatches(target, rule.path))
      .map((rule) => ({ ...rule, length: rule.path.replaceAll("*", "").replaceAll("$", "").length })),
  );
  if (!matches.length) {
    return true;
  }
  const mostSpecific = Math.max(...matches.map((rule) => rule.length));
  return matches.some((rule) => rule.length === mostSpecific && rule.kind === "allow");
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
