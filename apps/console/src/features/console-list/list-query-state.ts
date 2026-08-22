import {
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";

export const roleFilters = [
  "all",
  "live",
  "needs_review",
  "draft",
  "completed",
] as const;
export type RoleFilter = (typeof roleFilters)[number];

export const roleSorts = ["recent", "alpha"] as const;
export type RoleSort = (typeof roleSorts)[number];

export const candidateFilters = [
  "all",
  "to_review",
  "to_call",
  "archived",
] as const;
export type CandidateFilter = (typeof candidateFilters)[number];

export const candidateSorts = ["recent", "review", "name"] as const;
export type CandidateSort = (typeof candidateSorts)[number];

const navigationOptions = {
  history: "push" as const,
  scroll: false,
  shallow: false,
};

export const roleListParsers = {
  cursor: parseAsString.withOptions(navigationOptions),
  filter: parseAsStringLiteral(roleFilters)
    .withDefault("all")
    .withOptions(navigationOptions),
  q: parseAsString.withDefault("").withOptions(navigationOptions),
  sort: parseAsStringLiteral(roleSorts)
    .withDefault("recent")
    .withOptions(navigationOptions),
};

export const candidateListParsers = {
  cursor: parseAsString.withOptions(navigationOptions),
  filter: parseAsStringLiteral(candidateFilters)
    .withDefault("all")
    .withOptions(navigationOptions),
  q: parseAsString.withDefault("").withOptions(navigationOptions),
  sort: parseAsStringLiteral(candidateSorts)
    .withDefault("recent")
    .withOptions(navigationOptions),
};

export function useRoleListQueryState() {
  return useQueryStates(roleListParsers);
}

export function useCandidateListQueryState() {
  return useQueryStates(candidateListParsers);
}

