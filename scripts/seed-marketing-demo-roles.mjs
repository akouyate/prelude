#!/usr/bin/env node

import { createRequire } from "node:module";

import { MARKETING_DEMO_ROLE_FIXTURES } from "./marketing-demo-role-fixtures.mjs";

const requireFromDbPackage = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { PrismaClient } = requireFromDbPackage("@prisma/client");
const prisma = new PrismaClient();

const SYSTEM_USER_ID = "user_marketing_demo_system";
const SYSTEM_ORGANIZATION_ID = "org_marketing_demo_system";

async function main() {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      create: {
        id: SYSTEM_USER_ID,
        clerkUserId: "system_marketing_demo",
        email: "marketing-demo-system@hirecall.invalid",
        name: "HireCall Marketing Demo System",
      },
      update: {},
      where: { id: SYSTEM_USER_ID },
    });

    const organization = await tx.organization.upsert({
      create: {
        id: SYSTEM_ORGANIZATION_ID,
        clerkOrganizationId: "system_marketing_demo",
        name: "HireCall",
        onboardingCompletedAt: new Date(0),
        onboardingStep: "completed",
        settings: { systemPurpose: "marketing_demo" },
      },
      update: {
        settings: { systemPurpose: "marketing_demo" },
      },
      where: { id: SYSTEM_ORGANIZATION_ID },
    });

    await tx.organizationMembership.upsert({
      create: {
        id: "membership_marketing_demo_system",
        organizationId: organization.id,
        role: "owner",
        status: "active",
        userId: user.id,
      },
      update: { role: "owner", status: "active" },
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
    });

    await tx.marketingDemoControl.upsert({
      create: {
        id: "global",
        concurrentSessionCap: 2,
        dailyLeadCap: 100,
        dailyStartedSessionCap: 25,
        enabled: true,
      },
      update: {},
      where: { id: "global" },
    });

    for (const fixture of MARKETING_DEMO_ROLE_FIXTURES) {
      const { id: draftId, ...draftFixture } = fixture.draft;
      const job = await tx.job.upsert({
        create: {
          description: fixture.job.description,
          id: fixture.job.id,
          organizationId: organization.id,
          sourceExternalId: `marketing-demo:${fixture.slug}:v${fixture.version}`,
          sourceProvider: "system_fixture",
          status: "published",
          title: fixture.job.title,
        },
        update: {
          description: fixture.job.description,
          status: "published",
          title: fixture.job.title,
        },
        where: { id: fixture.job.id },
      });

      const draft = await tx.interviewDraft.upsert({
        create: {
          ...draftFixture,
          id: draftId,
          jobId: job.id,
          language: fixture.locale,
          organizationId: organization.id,
          schemaVersion: 1,
          status: "published",
        },
        update: {
          ...draftFixture,
          jobId: job.id,
          language: fixture.locale,
          organizationId: organization.id,
          schemaVersion: 1,
          status: "published",
        },
        where: { id: draftId },
      });

      await tx.marketingDemoRole.upsert({
        create: {
          id: fixture.id,
          slug: fixture.slug,
          enabled: fixture.enabled,
          displayOrder: fixture.displayOrder,
          publicTitle: fixture.publicTitle,
          publicSummary: fixture.publicSummary,
          publicBadge: fixture.publicBadge,
          locale: fixture.locale,
          version: fixture.version,
          draftId: draft.id,
          postInterviewQuestions: fixture.postInterviewQuestions,
        },
        update: {
          enabled: fixture.enabled,
          displayOrder: fixture.displayOrder,
          publicTitle: fixture.publicTitle,
          publicSummary: fixture.publicSummary,
          publicBadge: fixture.publicBadge,
          locale: fixture.locale,
          version: fixture.version,
          draftId: draft.id,
          postInterviewQuestions: fixture.postInterviewQuestions,
        },
        // Slug is the public identity across versions. A fixture can point the
        // role at a new versioned draft without colliding with the prior row;
        // already-minted previews keep their immutable snapshot.
        where: { slug: fixture.slug },
      });
    }
  });

  process.stdout.write(
    `Seeded ${MARKETING_DEMO_ROLE_FIXTURES.length} marketing demo roles.\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(
      `Marketing demo seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
