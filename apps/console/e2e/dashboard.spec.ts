import { expect, test } from "@playwright/test";

import { setupPreludeClerkTestingToken } from "./support/clerk-testing";

test.beforeEach(async ({ page }) => {
  await setupPreludeClerkTestingToken({ page });
});

test("dashboard loads the recruiter workspace", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Recruiter workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "New interview" })).toBeVisible();
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
  await page.goto("/interviews/new");

  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Calibrate the interview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add Communication signal" }).click();
  await page.getByRole("button", { name: "Create questions" }).click();

  await expect(page.getByText("Job brief only")).toBeVisible();
  await expect(page.getByText("3 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play question 1" }).click();
  await expect(
    page.getByRole("button", { name: "Pause question 1" }),
  ).toBeVisible();
  await page.getByText("Tell us about a recent project or situation").click();
  await page.getByRole("button", { name: "Improve with AI" }).click();

  await expect(
    page.getByText("Please include the context").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByLabel("Ask AI to add a question about").fill("mobility");
  await page.getByRole("button", { name: "Add with AI" }).click();
  await expect(page.getByText("4 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review evaluation" }).click();
  await expect(
    page.getByRole("heading", { name: "Set the evaluation standard" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save and share" }).click();
  await expect(
    page.getByRole("heading", { name: "Publish when ready" }),
  ).toBeVisible();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await expect(page.getByText("Candidate preview")).toHaveCount(0);

  await page
    .getByRole("button", { name: "Preview candidate experience" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Candidate preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close candidate preview" }).click();

  await page.getByRole("button", { name: "Publish interview" }).click();
  await expect(page.getByText("Interview published")).toBeVisible();
  await expect(page.getByText("prelude.ai/interview/iv_")).toBeVisible();
});
