import { describe, expect, it } from "vitest";

import { parseCandidateListQuery, parseRoleListQuery } from "./list-query";

describe("console list query policy", () => {
  it("fails closed for invalid role list controls and bounds search input", () => {
    const query = parseRoleListQuery({
      filter: "unknown",
      q: `  ${"x".repeat(140)}  `,
      sort: "candidate_count",
    });

    expect(query).toMatchObject({ filter: "all", sort: "recent" });
    expect(query.q).toHaveLength(120);
  });

  it("accepts only supported candidate list controls", () => {
    expect(
      parseCandidateListQuery({
        cursor: "hc.v1.cursor",
        filter: "to_call",
        q: "Ada Martin",
        sort: "name",
      }),
    ).toEqual({
      cursor: "hc.v1.cursor",
      filter: "to_call",
      q: "Ada Martin",
      sort: "name",
    });
  });
});
