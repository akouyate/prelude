import type { ImportedRoleDraft } from "@prelude/contracts";

import {
  extractRoleIntakeHtmlText,
  toImportedRoleDraft,
} from "./role-intake-url-extractor";

/**
 * The major applicant tracking systems publish every posting on their hosted
 * board through an unauthenticated JSON API. Reading that API instead of the
 * board markup yields the fields the recruiter actually reviews — title,
 * location, description — without page furniture, and without depending on how
 * the board renders. Resolution is pure: callers own the fetch, so the
 * importer's DNS pinning and response limits still apply.
 */
export type RoleIntakeAtsPlatform = "ashby" | "greenhouse" | "lever";

export type RoleIntakeAtsPosting = {
  canonicalUrl: string | null;
  draft: ImportedRoleDraft;
};

export type RoleIntakeAtsSource = {
  apiUrl: URL;
  mapPayload: (payload: unknown) => RoleIntakeAtsPosting | null;
  /** Omitted when the platform's default response budget is enough. */
  maxResponseBytes?: number;
  platform: RoleIntakeAtsPlatform;
};

const NUMERIC_ID = /^\d{1,20}$/;
const OPAQUE_ID = /^[a-z0-9-]{8,64}$/i;
const ORGANIZATION = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

// Ashby answers with a whole board rather than one posting. The largest board
// measured was 11 MB, so its budget clears that: falling through would reach a
// client-rendered shell that cannot be read, then a paid model call.
const ASHBY_MAX_RESPONSE_BYTES = 16_000_000;

export function resolveRoleIntakeAtsSource(
  url: URL,
): RoleIntakeAtsSource | null {
  return resolveGreenhouse(url) ?? resolveLever(url) ?? resolveAshby(url);
}

/**
 * Greenhouse mirrors its board on a regional API host and escapes the markup in
 * `content`, which the shared HTML reader decodes.
 */
function resolveGreenhouse(url: URL): RoleIntakeAtsSource | null {
  const region = matchBoardHost(
    url,
    /^(?:job-boards|boards)\.(?:([a-z0-9-]+)\.)?greenhouse\.io$/,
  );
  const board = region === null ? null : matchBoardPath(url, ["", "jobs", ""], NUMERIC_ID);
  if (!board) {
    return null;
  }

  return {
    apiUrl: new URL(
      `https://boards-api.${region}greenhouse.io/v1/boards/${board.organization}/jobs/${board.id}`,
    ),
    mapPayload: (payload) => {
      const record = asRecord(payload);
      return record
        ? toPosting({
            canonicalUrl: asText(record.absolute_url),
            description: readHtml(record.content),
            location: asText(asRecord(record.location)?.name),
            title: asText(record.title),
          })
        : null;
    },
    platform: "greenhouse",
  };
}

/**
 * Lever splits a posting across an intro, titled list sections and a closing
 * block. Only the concatenation reads as the job description a recruiter wrote.
 */
function resolveLever(url: URL): RoleIntakeAtsSource | null {
  const region = matchBoardHost(
    url,
    /^jobs\.(?:([a-z0-9-]+)\.)?lever\.co$/,
  );
  const board = region === null ? null : matchBoardPath(url, ["", ""], OPAQUE_ID);
  if (!board) {
    return null;
  }

  return {
    apiUrl: new URL(
      `https://api.${region}lever.co/v0/postings/${board.organization}/${board.id}`,
    ),
    mapPayload: (payload) => {
      const record = asRecord(payload);
      if (!record) {
        return null;
      }
      const categories = asRecord(record.categories);
      const sections = [
        readHtml(record.description),
        ...asArray(record.lists).map((entry) => {
          const list = asRecord(entry);
          return [asText(list?.text), readHtml(list?.content)]
            .filter(Boolean)
            .join("\n");
        }),
        readHtml(record.additional),
      ].filter(Boolean);

      return toPosting({
        canonicalUrl: asText(record.hostedUrl),
        description: sections.join("\n\n"),
        location:
          asText(categories?.location) ??
          asText(asArray(categories?.allLocations)[0]),
        title: asText(record.text),
      });
    },
    platform: "lever",
  };
}

/**
 * Ashby exposes the board as a whole rather than one posting at a time, so the
 * requested job is selected from the payload. Its board page is client-rendered,
 * which is why the API is the only readable form.
 */
function resolveAshby(url: URL): RoleIntakeAtsSource | null {
  const board =
    url.hostname === "jobs.ashbyhq.com"
      ? matchBoardPath(url, ["", ""], OPAQUE_ID)
      : null;
  if (!board) {
    return null;
  }

  return {
    apiUrl: new URL(
      `https://api.ashbyhq.com/posting-api/job-board/${board.organization}`,
    ),
    mapPayload: (payload) => {
      const job = asArray(asRecord(payload)?.jobs)
        .map(asRecord)
        .find((candidate) => candidate?.id === board.id);
      return job
        ? toPosting({
            canonicalUrl: asText(job.jobUrl),
            description:
              readHtml(job.descriptionHtml) || readHtml(job.descriptionPlain),
            location: asText(job.location),
            title: asText(job.title),
          })
        : null;
    },
    maxResponseBytes: ASHBY_MAX_RESPONSE_BYTES,
    platform: "ashby",
  };
}

/**
 * Matches a hosted board host and returns the provider's region infix, so an
 * EU-resident board resolves to its EU API rather than the US one. The empty
 * string means "matched, no region", which is why callers test against null.
 */
function matchBoardHost(url: URL, pattern: RegExp): string | null {
  const match = url.hostname.match(pattern);
  if (!match) {
    return null;
  }
  return match[1] ? `${match[1]}.` : "";
}

/**
 * Reads a board path against a template whose empty entries are captures, so
 * `["", "jobs", ""]` yields the organization and job id only when the fixed
 * segments line up. Both are interpolated into an API URL, so anything that is
 * not a plain identifier is rejected rather than escaped.
 */
function matchBoardPath(
  url: URL,
  template: string[],
  idPattern: RegExp,
): { id: string; organization: string } | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== template.length) {
    return null;
  }

  const captures: string[] = [];
  for (const [index, expected] of template.entries()) {
    const segment = segments[index]!;
    if (expected === "") {
      captures.push(decodeURIComponent(segment));
    } else if (segment.toLowerCase() !== expected) {
      return null;
    }
  }

  const [organization, id] = captures;
  return organization &&
    id &&
    ORGANIZATION.test(organization) &&
    idPattern.test(id)
    ? { id, organization }
    : null;
}

function toPosting(input: {
  canonicalUrl: string | null;
  description: string;
  location: string | null;
  title: string | null;
}): RoleIntakeAtsPosting | null {
  return input.description
    ? { canonicalUrl: input.canonicalUrl, draft: toImportedRoleDraft(input) }
    : null;
}

function readHtml(value: unknown): string {
  return typeof value === "string" ? extractRoleIntakeHtmlText(value) : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
