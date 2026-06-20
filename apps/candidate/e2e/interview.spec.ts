import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("candidate can join a mocked LiveKit interview room on mobile", async ({
  context,
  page
}) => {
  await context.grantPermissions(["microphone", "camera"]);
  await page.route("/api/live-interview-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "is_e2e",
        status: "waiting_candidate",
        allowedModalities: ["audio", "video"],
        livekit: {
          roomName: "prelude-is_e2e",
          url: "wss://mock-livekit.prelude.local",
          token: "mock_lk_is_e2e",
          participant: "candidate-demo-token",
          expiresAt: "2026-06-17T21:24:14.943249Z",
          isMock: true
        }
      })
    });
  });

  await page.goto("/interview/demo-token");
  await expect(
    page.getByRole("heading", {
      name: "Meet your Prelude AI interviewer."
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "Start live interview" }).click();

  await expect(page.getByText("prelude-is_e2e")).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "End" })).toBeVisible();
});

test("candidate sees a clear error when microphone permission is denied", async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () =>
          Promise.reject(
            new DOMException("Permission denied", "NotAllowedError")
          )
      }
    });
  });
  await page.route("/api/live-interview-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "is_denied",
        status: "waiting_candidate",
        allowedModalities: ["audio", "video"],
        livekit: {
          roomName: "prelude-is_denied",
          url: "wss://mock-livekit.prelude.local",
          token: "mock_lk_is_denied",
          participant: "candidate-denied",
          expiresAt: "2026-06-17T21:24:14.943249Z",
          isMock: true
        }
      })
    });
  });

  await page.goto("/interview/demo-token");
  await page.getByRole("button", { name: "Start live interview" }).click();

  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Microphone access is required to start the live interview.")
  ).toBeVisible();
});
