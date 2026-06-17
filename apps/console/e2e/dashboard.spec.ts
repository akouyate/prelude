import { expect, test } from "@playwright/test";

test("dashboard placeholder loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recruiter dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /New job/i })).toBeVisible();
});
