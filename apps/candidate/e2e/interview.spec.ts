import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

type CandidateFixture = {
  candidateToken: string;
  organizationId: string;
};

test.use({ viewport: { width: 390, height: 844 } });

let fixture: CandidateFixture;

test.beforeEach(async () => {
  await fetch("http://127.0.0.1:18081/__debug/reset", {
    method: "POST",
  }).catch(() => undefined);
  fixture = await seedPublishedInterview();
});

test.afterEach(async () => {
  await cleanupPublishedInterview(fixture);
});

test("candidate can join a mocked LiveKit interview room on mobile", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["microphone"]);

  await page.goto(`/interview/${fixture.candidateToken}`);
  await expect(
    page.getByRole("heading", {
      name: "Customer Success Manager",
    }),
  ).toBeVisible();
  await expect(page.getByText("Private interview")).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByText("Before you start")).toBeVisible();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel(/I understand that I am joining/).check();
  await page.getByRole("button", { name: "Join the interview" }).click();

  await expect(page.getByText("Live now", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quit" })).toBeVisible();
  await page.getByRole("button", { name: "Quit" }).click();
  await expect(
    page.getByRole("heading", { name: "Interview ended" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start a new attempt" }),
  ).toBeVisible();
});

test("candidate can complete the written fallback when microphone permission is denied", async ({
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

  await page.goto(`/interview/${fixture.candidateToken}`);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel(/I understand that I am joining/).check();
  await page.getByRole("button", { name: "Join the interview" }).click();

  await expect(
    page.getByText("Needs attention", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Microphone access is required to start the live interview.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use written fallback" }).click();
  await expect(
    page.getByRole("heading", { name: "Answer in writing" }),
  ).toBeVisible();
  await page
    .getByLabel("Answer question 1")
    .fill(
      "I am interested in customer onboarding because I enjoy improving the handoff between sales, support, and product teams.",
    );
  await page
    .getByLabel("Answer question 2")
    .fill(
      "I would acknowledge the implementation issue, clarify the business impact, align owners, and give the customer a concrete recovery plan.",
    );
  await page.getByRole("button", { name: "Submit answers" }).click();
  await expect(
    page.getByRole("heading", { name: /Thank you, Ada/i }),
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

  const interview = await prisma.interview.create({
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
        {
          id: "customer_recovery",
          prompt:
            "How would you handle an at-risk customer after a difficult implementation?",
          signal: "Customer judgement and communication.",
        },
      ],
      responseModes: ["audio", "text"],
      roleBrief:
        "Customer success first screen focused on customer judgement and communication.",
      roleTitle: "Customer Success Manager",
      status: "published",
    },
  });
  const invitation = await prisma.candidateInvitation.create({
    data: {
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      interviewId: interview.id,
      jobId: job.id,
      organizationId: organization.id,
      status: "invited",
      token: `ci_${id}`,
    },
  });

  return {
    candidateToken: invitation.token,
    organizationId: organization.id,
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
    "postgresql://postgres:postgres@localhost:5440/prelude?schema=public";
}
