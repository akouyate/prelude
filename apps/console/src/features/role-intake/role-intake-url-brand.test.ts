import { describe, expect, it } from "vitest";

import { detectRoleIntakeUrlBrand } from "./role-intake-url-brand";

describe("detectRoleIntakeUrlBrand", () => {
  it("recognizes supported job-source domains", () => {
    expect(
      detectRoleIntakeUrlBrand("https://www.linkedin.com/jobs/view/4436807221"),
    ).toBe("linkedin");
    expect(
      detectRoleIntakeUrlBrand("https://boards.greenhouse.io/hirecall/jobs/1"),
    ).toBe("greenhouse");
  });

  it("recognizes a pasted hostname before the user adds a scheme", () => {
    expect(
      detectRoleIntakeUrlBrand("linkedin.com/jobs/view/4436807221"),
    ).toBe("linkedin");
  });

  // Indeed is refused by the intake policy, so it must never be advertised with
  // a logo as if HireCall could read it.
  it("does not advertise a source HireCall cannot read", () => {
    expect(
      detectRoleIntakeUrlBrand("https://fr.indeed.com/viewjob?jk=example"),
    ).toBeNull();
    expect(
      detectRoleIntakeUrlBrand(
        "https://www.welcometothejungle.com/fr/companies/sii/jobs/pmo",
      ),
    ).toBeNull();
  });

  it("keeps unknown and lookalike domains generic", () => {
    expect(detectRoleIntakeUrlBrand("https://careers.example.com/jobs/1")).toBeNull();
    expect(detectRoleIntakeUrlBrand("https://linkedin.example.com/jobs/1")).toBeNull();
    expect(detectRoleIntakeUrlBrand("not a URL")).toBeNull();
  });
});
