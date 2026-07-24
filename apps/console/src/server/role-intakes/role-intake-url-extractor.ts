import { parseDocument } from "htmlparser2";

import type { ImportedRoleDraft, RoleIntakeWarning } from "@prelude/contracts";

import { RoleIntakeUrlImportError } from "./role-intake-url-policy";

const MIN_ROLE_DESCRIPTION_CHARACTERS = 40;
const MAX_EXTRACTED_DESCRIPTION_CHARACTERS = 100_000;
const ignoredHtmlElements = new Set([
  "audio",
  "base",
  "canvas",
  "form",
  "iframe",
  "img",
  "input",
  "noscript",
  "picture",
  "script",
  "source",
  "style",
  "svg",
  "template",
  "video",
]);
const boilerplateHtmlElements = new Set(["aside", "footer", "header", "nav"]);

export type RoleIntakeFieldSource =
  | "job_posting_json_ld"
  | "main_content"
  | "heading"
  | "page_title"
  | "unavailable";

export type RoleIntakeUrlFieldSources = {
  description: RoleIntakeFieldSource;
  location: RoleIntakeFieldSource;
  title: RoleIntakeFieldSource;
};

/**
 * Static extraction intentionally ignores instructions in markup. It reads
 * structured JobPosting data first, then visible role text as a fallback.
 */
export function extractRoleIntakeUrlDraft(html: string): {
  draft: ImportedRoleDraft;
  fieldSources: RoleIntakeUrlFieldSources;
  warnings: RoleIntakeWarning[];
} {
  const document = parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true });
  const nodes = collectHtmlNodes(document as unknown as HtmlNode);
  const structured = extractJobPosting(nodes);
  const main = findFirstElement(nodes, ["main", "article"]);
  const body = findFirstElement(nodes, ["body"]);
  const visibleContent = normalizeVisibleText(main ?? body ?? (document as unknown as HtmlNode), {
    excludeBoilerplate: !main,
  });
  const heading = normalizeText(nodeText(findFirstElement(nodes, ["h1"])));
  const pageTitle = normalisePageTitle(nodeText(findFirstElement(nodes, ["title"])));
  const structuredDescription = structured?.description
    ? normalizeVisibleText(parseDocument(structured.description) as unknown as HtmlNode, {
        excludeBoilerplate: false,
      })
    : "";
  const description = firstUsefulText(structuredDescription, visibleContent);
  if (description.length < MIN_ROLE_DESCRIPTION_CHARACTERS || looksLikeAuthenticationGate(description)) {
    throw new RoleIntakeUrlImportError(
      "no_usable_text",
      "Prelude could not find a usable public job description. Start from a manual brief instead.",
    );
  }

  const title = firstNonEmpty(structured?.title, heading, pageTitle);
  const location = structured?.location ?? null;
  const fieldSources: RoleIntakeUrlFieldSources = {
    description: structuredDescription ? "job_posting_json_ld" : "main_content",
    location: location ? "job_posting_json_ld" : "unavailable",
    title: structured?.title
      ? "job_posting_json_ld"
      : heading
        ? "heading"
        : pageTitle
          ? "page_title"
          : "unavailable",
  };
  const warnings: RoleIntakeWarning[] = [];
  if (!title) {
    warnings.push({
      code: "title_unavailable",
      message: "Prelude could not identify a role title. Add one before continuing.",
    });
  }
  if (!location) {
    warnings.push({
      code: "location_unavailable",
      message: "Prelude could not identify a location. Add one if it matters for this role.",
    });
  }
  if (!structuredDescription) {
    warnings.push({
      code: "description_extracted_from_page",
      message: "The job description was extracted from visible page content. Review it before continuing.",
    });
  }

  return {
    draft: {
      description: description.slice(0, MAX_EXTRACTED_DESCRIPTION_CHARACTERS),
      location: location?.slice(0, 160) ?? null,
      title: title?.slice(0, 160) ?? null,
    },
    fieldSources,
    warnings,
  };
}

type HtmlNode = {
  attribs?: Record<string, string | undefined>;
  children?: HtmlNode[];
  data?: string;
  name?: string;
  type?: string;
};

function collectHtmlNodes(root: HtmlNode): HtmlNode[] {
  const nodes: HtmlNode[] = [];
  const visit = (node: HtmlNode) => {
    nodes.push(node);
    node.children?.forEach(visit);
  };
  visit(root);
  return nodes;
}

function findFirstElement(nodes: HtmlNode[], names: string[]): HtmlNode | undefined {
  return nodes.find((node) => node.type === "tag" && node.name && names.includes(node.name));
}

function nodeText(node: HtmlNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.data ?? "";
  }
  if (node.name && ignoredHtmlElements.has(node.name)) {
    return "";
  }
  return node.children?.map(nodeText).join(" ") ?? "";
}

function rawNodeText(node: HtmlNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.data ?? "";
  }
  return node.children?.map(rawNodeText).join("") ?? "";
}

function normalizeVisibleText(root: HtmlNode, options: { excludeBoilerplate: boolean }): string {
  const visit = (node: HtmlNode): string => {
    if (node.type === "text") {
      return node.data ?? "";
    }
    if (
      node.name &&
      (ignoredHtmlElements.has(node.name) ||
        (options.excludeBoilerplate && boilerplateHtmlElements.has(node.name)))
    ) {
      return "";
    }
    const content = node.children?.map(visit).join(" ") ?? "";
    return node.name && ["br", "div", "li", "p", "section", "h1", "h2", "h3"].includes(node.name)
      ? `${content}\n`
      : content;
  };
  return normalizeText(visit(root));
}

function extractJobPosting(nodes: HtmlNode[]): {
  description: string | null;
  location: string | null;
  title: string | null;
} | null {
  for (const node of nodes) {
    if (
      node.name !== "script" ||
      !node.attribs?.type?.toLowerCase().includes("application/ld+json")
    ) {
      continue;
    }
    const content = rawNodeText(node).trim();
    if (!content || content.length > 128 * 1024) {
      continue;
    }
    try {
      for (const candidate of flattenStructuredJson(JSON.parse(content))) {
        if (!isJobPosting(candidate)) {
          continue;
        }
        return {
          description: asString(candidate.description),
          location: extractJobLocation(candidate.jobLocation),
          title: asString(candidate.title),
        };
      }
    } catch {
      // Invalid third-party JSON-LD is an extraction fallback, not a job failure.
    }
  }
  return null;
}

function flattenStructuredJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenStructuredJson);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  return [record, ...flattenStructuredJson(record["@graph"])];
}

function isJobPosting(value: Record<string, unknown>): boolean {
  const type = value["@type"];
  return (Array.isArray(type) ? type : [type]).some(
    (candidate) => typeof candidate === "string" && candidate.toLowerCase() === "jobposting",
  );
}

function extractJobLocation(value: unknown): string | null {
  const location = Array.isArray(value) ? value[0] : value;
  if (typeof location === "string") {
    return normalizeText(location) || null;
  }
  if (!location || typeof location !== "object") {
    return null;
  }
  const address = (location as Record<string, unknown>).address;
  if (typeof address === "string") {
    return normalizeText(address) || null;
  }
  if (!address || typeof address !== "object") {
    return null;
  }
  const record = address as Record<string, unknown>;
  return [record.addressLocality, record.addressRegion, record.addressCountry]
    .flatMap((part) => {
      const value = asString(part);
      return value ? [value] : [];
    })
    .join(", ")
    .trim() || null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? normalizeText(value) || null : null;
}

function firstUsefulText(...values: string[]): string {
  return values.find((value) => value.length >= MIN_ROLE_DESCRIPTION_CHARACTERS) ?? "";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim() ?? null;
}

function normalisePageTitle(value: string): string {
  return normalizeText(value).split(/\s+[|—–-]\s+/)[0]?.trim() ?? "";
}

function looksLikeAuthenticationGate(value: string): boolean {
  return /^(sign in|log in|please wait|verify you are human|access denied)/i.test(value.trim());
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
