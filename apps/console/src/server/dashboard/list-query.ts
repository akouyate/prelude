import type {
  CandidateFilter,
  CandidateSort,
  RoleFilter,
  RoleSort,
} from "../../features/console-list/list-query-state";

type SearchParams = Record<string, string | string[] | undefined>;

export type RoleListQuery = {
  cursor: string | null;
  filter: RoleFilter;
  q: string;
  sort: RoleSort;
};

export type CandidateListQuery = {
  cursor: string | null;
  filter: CandidateFilter;
  q: string;
  sort: CandidateSort;
};

const maxSearchLength = 120;

function readValue(params: SearchParams, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function readSearch(params: SearchParams) {
  return (readValue(params, "q") ?? "").trim().slice(0, maxSearchLength);
}

function isOneOf<T extends readonly string[]>(
  value: string | null,
  options: T,
): value is T[number] {
  return Boolean(value && options.includes(value));
}

export function parseRoleListQuery(params: SearchParams): RoleListQuery {
  const filter = readValue(params, "filter");
  const sort = readValue(params, "sort");

  return {
    cursor: readValue(params, "cursor"),
    filter: isOneOf(filter, [
      "all",
      "live",
      "needs_review",
      "draft",
      "completed",
    ] as const)
      ? filter
      : "all",
    q: readSearch(params),
    sort: isOneOf(sort, ["recent", "alpha"] as const) ? sort : "recent",
  };
}

export function parseCandidateListQuery(
  params: SearchParams,
): CandidateListQuery {
  const filter = readValue(params, "filter");
  const sort = readValue(params, "sort");

  return {
    cursor: readValue(params, "cursor"),
    filter: isOneOf(filter, [
      "all",
      "to_review",
      "to_call",
      "archived",
    ] as const)
      ? filter
      : "all",
    q: readSearch(params),
    sort: isOneOf(sort, ["recent", "review", "name"] as const)
      ? sort
      : "recent",
  };
}
