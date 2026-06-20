import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

type CandidateFixture = {
  organizationId: string;
  publicToken: string;
};

test.use({ viewport: { width: 390, height: 844 } });

let fixture: CandidateFixture;

test.beforeAll(async () => {
  fixture = await seedPublishedInterview();
});

test.afterAll(async () => {
  await cleanupPublishedInterview(fixture);
});

test("candidate can join a mocked LiveKit interview room on mobile", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["microphone", "camera"]);
  await page.route("/api/live-interview-sessions/*/events", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ duplicate: false }),
    });
  });
  await page.route("/api/candidate-sessions/*/complete", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ completed: true }),
    });
  });
  await page.route("/api/live-interview-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "is_e2e",
        productSessionId: "cs_e2e",
        resumeToken: "cs_resume_e2e",
        status: "waiting_candidate",
        allowedModalities: ["audio", "video"],
        livekit: {
          roomName: "prelude-is_e2e",
          url: "wss://mock-livekit.prelude.local",
          token: "mock_lk_is_e2e",
          participant: "candidate-demo-token",
          expiresAt: "2026-06-17T21:24:14.943249Z",
          isMock: true,
        },
      }),
    });
  });

  await page.goto(`/interview/${fixture.publicToken}`);
  await expect(
    page.getByRole("heading", {
      name: "Customer Success Manager",
    }),
  ).toBeVisible();
  await expect(page.getByText("Before you start")).toBeVisible();
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel(/I agree to join this AI-guided/).check();
  await page.getByRole("button", { name: "Start live interview" }).click();

  await expect(page.getByText("prelude-is_e2e")).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "End" })).toBeVisible();
  await page.getByRole("button", { name: "End" }).click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
});

test("candidate sees a clear error when microphone permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () =>
          Promise.reject(
            new DOMException("Permission denied", "NotAllowedError"),
          ),
      },
    });
  });
  await page.route("/api/live-interview-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "is_denied",
        productSessionId: "cs_denied",
        resumeToken: "cs_resume_denied",
        status: "waiting_candidate",
        allowedModalities: ["audio", "video"],
        livekit: {
          roomName: "prelude-is_denied",
          url: "wss://mock-livekit.prelude.local",
          token: "mock_lk_is_denied",
          participant: "candidate-denied",
          expiresAt: "2026-06-17T21:24:14.943249Z",
          isMock: true,
        },
      }),
    });
  });

  await page.goto(`/interview/${fixture.publicToken}`);
  await page.getByLabel(/I agree to join this AI-guided/).check();
  await page.getByRole("button", { name: "Start live interview" }).click();

  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Microphone access is required to start the live interview.",
    ),
  ).toBeVisible();
});

async function seedPublishedInterview(): Promise<CandidateFixture> {
  loadRootEnv();
  const { prisma } = await import("@prelude/db");
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  const publicToken = `e2e_${id}`;
  const organization = await prisma.organization.create({
    data: {
      name: "Acme Talent",
    },
  });
  const job = await prisma.job.create({
    data: {
      description:
        "First screen candidates for customer onboarding and retention roles.",
      organizationId: organization.id,
      title: "Customer Success Manager",
    },
  });

  await prisma.interview.create({
    data: {
      criteria: [
        {
          id: "customer_judgement",
          label: "Customer judgement",
          prompt: "Understands onboarding and escalation signals.",
        },
      ],
      estimatedMinutes: 4,
      focus: ["customer success", "retention"],
      guardrails: [
        {
          id: "fairness",
          label: "Fairness",
          prompt:
            "Do not assess protected attributes, appearance, accent, tone, or emotion.",
        },
      ],
      jobId: job.id,
      organizationId: organization.id,
      publicToken,
      questions: [
        {
          id: "intro",
          prompt:
            "Can you briefly introduce yourself and explain why this role interests you?",
          signal: "Clear and relevant introduction.",
        },
      ],
      responseModes: ["audio", "video"],
      roleBrief:
        "Customer success first screen focused on customer judgement and communication.",
      roleTitle: "Customer Success Manager",
      status: "published",
    },
  });

  return {
    organizationId: organization.id,
    publicToken,
  };
}

async function cleanupPublishedInterview(candidateFixture?: CandidateFixture) {
  if (!candidateFixture) {
    return;
  }

  const { prisma } = await import("@prelude/db");
  await prisma.candidateSession.deleteMany({
    where: { organizationId: candidateFixture.organizationId },
  });
  await prisma.interview.deleteMany({
    where: { organizationId: candidateFixture.organizationId },
  });
  await prisma.job.deleteMany({
    where: { organizationId: candidateFixture.organizationId },
  });
  await prisma.organization.deleteMany({
    where: { id: candidateFixture.organizationId },
  });
  await prisma.$disconnect();
}

function loadRootEnv() {
  process.env.DATABASE_URL =
    process.env.E2E_DATABASE_URL ??
    (process.env.CI ? process.env.DATABASE_URL : undefined) ??
    "postgresql://postgres:postgres@localhost:55432/prelude?schema=public";
}
