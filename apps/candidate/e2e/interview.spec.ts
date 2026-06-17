import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("candidate interview placeholder loads on mobile", async ({ page }) => {
  await page.goto("/interview/demo-token");
  await expect(
    page.getByRole("heading", {
      name: "Three short questions before the recruiter call."
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start pre-interview" })).toBeVisible();
});
