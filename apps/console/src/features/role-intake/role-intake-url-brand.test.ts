import { describe, expect, it } from "vitest";

import { detectRoleIntakeUrlBrand } from "./role-intake-url-brand";

describe("detectRoleIntakeUrlBrand", () => {
  it("recognizes supported job-source domains", () => {
    expect(
      detectRoleIntakeUrlBrand("https://www.linkedin.com/jobs/view/4436807221"),
    ).toBe("linkedin");
    expect(
      detectRoleIntakeUrlBrand("https://fr.indeed.com/viewjob?jk=example"),
    ).toBe("indeed");
    expect(
      detectRoleIntakeUrlBrand("https://boards.greenhouse.io/hirecall/jobs/1"),
    ).toBe("greenhouse");
  });

  it("recognizes a pasted hostname before the user adds a scheme", () => {
    expect(
      detectRoleIntakeUrlBrand("linkedin.com/jobs/view/4436807221"),
    ).toBe("linkedin");
  });

  it("keeps unknown and lookalike domains generic", () => {
    expect(detectRoleIntakeUrlBrand("https://careers.example.com/jobs/1")).toBeNull();
    expect(detectRoleIntakeUrlBrand("https://linkedin.example.com/jobs/1")).toBeNull();
    expect(detectRoleIntakeUrlBrand("not a URL")).toBeNull();
  });
});
