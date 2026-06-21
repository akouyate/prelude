import { expect, test } from "@playwright/test";

import { setupPreludeClerkTestingToken } from "./support/clerk-testing";

test.beforeEach(async ({ page }) => {
  await setupPreludeClerkTestingToken({ page });
});

test("dashboard loads the recruiter workspace", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening)/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "New role screen" }),
  ).toBeVisible();
});

test("login explains the local auth mock when Clerk keys are missing", async ({
  page,
}) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Local auth mock is enabled" }),
  ).toBeVisible();
});

test("interview agent saves and publishes a draft", async ({ page }) => {
  await page.goto("/roles/new");

  await expect(
    page.getByPlaceholder("Senior Product Designer"),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder(/Paste the job description/u),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Role" })
    .fill("Customer Success Manager");
  await page
    .getByLabel("Job description")
    .fill(
      "We are hiring a Customer Success Manager to onboard SMB customers, reduce churn risk, coordinate with product teams, and turn customer feedback into practical improvements. The role needs clear communication, prioritization, and comfort handling ambiguous customer situations.",
    );
  await page.locator("section").getByRole("button", { name: "Calibrate" }).click();

  await expect(
    page.getByRole("heading", { name: "Calibrate the role screen" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Form/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Audio/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Video/u })).toHaveCount(0);
  await page.getByRole("button", { name: "Draft questions" }).click();

  await expect(page.getByText("Job brief only")).toBeVisible();
  await expect(page.getByText("4 questions", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Regenerate draft" }).click();
  await expect(page.getByText("4 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play question 1" }).click();
  await expect(
    page.getByRole("button", { name: "Pause question 1" }),
  ).toBeVisible();
  await page.locator("article").first().getByRole("button").nth(1).click();
  await page.getByRole("button", { exact: true, name: "Improve" }).click();

  await expect(
    page.getByText("Please include the situation").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page
    .getByLabel("Question 1 prompt")
    .fill("Tell us about one customer onboarding project with a clear result.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText("Tell us about one customer onboarding project with a clear result."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByLabel("Ask Prelude to add a question about").fill("mobility");
  await page.getByRole("button", { name: "Add with Prelude" }).click();
  await expect(page.getByText("5 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review evaluation" }).click();
  await expect(
    page.getByRole("heading", { name: "Set the evaluation standard" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(
    page.getByRole("heading", { name: "Publish the role screen" }),
  ).toBeVisible();
  await expect(
    page.locator("section").getByText("Draft saved"),
  ).toBeVisible();
  await expect(page.getByText("Candidate preview")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Preview candidate experience" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Candidate preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close candidate preview" }).click();

  await page.getByRole("button", { name: "Publish role screen" }).click();
  await expect(page.getByText("Role screen published")).toBeVisible();
  await expect(page.getByText("prelude.ai/interview/iv_")).toBeVisible();
});
