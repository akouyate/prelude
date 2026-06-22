import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The Go realtime control plane reads the published Interview row DIRECTLY from
 * this shared Postgres database (see services/realtime/internal/adapters/store/
 * postgres.go `GetInterviewPlan`):
 *
 *   select id, "roleTitle", seniority, "responseModes", questions, guardrails, "roleBrief"
 *   from "Interview" where id = $1 and status = 'published'
 *
 * There is no compile-time link between that Go query and this Prisma schema, so a
 * column rename here would SILENTLY break the live AI interviewer. This guard fails
 * the JS CI (no database needed) if any of those columns disappears — pairing with
 * the env-gated Go integration test that only runs when Postgres is up.
 */
const REQUIRED_INTERVIEW_FIELDS = [
  "id",
  "roleTitle",
  "seniority",
  "responseModes",
  "questions",
  "guardrails",
  "roleBrief",
  "status",
];

describe("Interview <-> realtime Go control-plane column contract", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(
    join(here, "../prisma/schema.prisma"),
    "utf8",
  );
  const interviewModel =
    schema.match(/model Interview \{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("keeps the columns the Go realtime GetInterviewPlan query reads", () => {
    expect(interviewModel).not.toBe("");
    for (const field of REQUIRED_INTERVIEW_FIELDS) {
      expect(interviewModel).toMatch(new RegExp(`\\n\\s+${field}\\s`));
    }
  });
});
