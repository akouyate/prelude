import { expect, test } from "@playwright/test";

test("dashboard placeholder loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Prelude.ai")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with the role" })).toBeVisible();
});

test("mock interview agent generates an attachment-aware draft", async ({ page }) => {
  await page.goto("/");

  await page.setInputFiles("input[type=file]", {
    name: "scorecard.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("mock scorecard")
  });
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Calibrate the interview" })).toBeVisible();
  await page.getByRole("button", { name: "Add Communication signal" }).click();
  await page.getByRole("button", { name: "Create questions" }).click();

  await expect(page.getByText("Attachment-aware")).toBeVisible();
  await expect(page.getByText("4 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play question 1" }).click();
  await expect(page.getByRole("button", { name: "Pause question 1" })).toBeVisible();
  await page
    .getByText("Tell us about a recent project or situation")
    .click();
  await page.getByRole("button", { name: "Improve with IA" }).click();

  await expect(page.getByText("Please include the context").first()).toBeVisible();
  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByLabel("Ask IA to add a question about").fill("mobility");
  await page.getByRole("button", { name: "Add with IA" }).click();
  await expect(page.getByText("5 questions", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review evaluation" }).click();
  await expect(
    page.getByRole("heading", { name: "Set the evaluation standard" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Prepare to share" }).click();
  await expect(page.getByRole("heading", { name: "Publish when ready" })).toBeVisible();
  await expect(page.getByText("prelude.ai/i/demo-token")).toBeVisible();
  await expect(page.getByText("Candidate preview")).toHaveCount(0);

  await page.getByRole("button", { name: "Preview candidate experience" }).click();
  await expect(page.getByRole("dialog", { name: "Candidate preview" })).toBeVisible();
});
