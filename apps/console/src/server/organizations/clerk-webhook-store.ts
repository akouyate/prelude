import "server-only";

import { prisma } from "@prelude/db";

import type { ClerkSyncStore } from "./clerk-webhook-sync";

/**
 * Prisma-backed ClerkSyncStore: projects Clerk's authoritative organization
 * state into our DB. All writes are idempotent (Clerk retries webhooks), and a
 * membership's role is stored under our own role vocabulary so the existing
 * organization-scope resolver reads it directly.
 */
export const prismaClerkSyncStore: ClerkSyncStore = {
  async findOrganizationIdByClerkId(clerkOrganizationId) {
    const organization = await prisma.organization.findUnique({
      where: { clerkOrganizationId },
      select: { id: true },
    });
    return organization?.id ?? null;
  },

  async upsertUser({ clerkUserId, email, name }) {
    // Reconcile by Clerk id first, then by email (the person may already exist
    // from a prior invitation or another org), else create.
    const byClerkId = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
    if (byClerkId) {
      await prisma.user.update({
        where: { id: byClerkId.id },
        data: {
          ...(email ? { email } : {}),
          ...(name ? { name } : {}),
        },
      });
      return byClerkId.id;
    }

    if (email) {
      const byEmail = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (byEmail) {
        await prisma.user.update({
          where: { id: byEmail.id },
          data: { clerkUserId, ...(name ? { name } : {}) },
        });
        return byEmail.id;
      }

      const created = await prisma.user.create({
        data: { clerkUserId, email, name: name ?? undefined },
      });
      return created.id;
    }

    // email is required + unique by schema; a membership event should always
    // carry an identifier. Throw so Clerk retries rather than silently dropping.
    throw new Error(
      "Cannot provision a user from a Clerk membership without an email identifier.",
    );
  },

  async upsertMembership({ organizationId, userId, role }) {
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      update: { role, status: "active" },
      create: { organizationId, userId, role, status: "active" },
    });
  },

  async deactivateMembership({ organizationId, clerkUserId }) {
    const user = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
    if (!user) {
      return;
    }
    await prisma.organizationMembership.updateMany({
      where: { organizationId, userId: user.id },
      data: { status: "inactive" },
    });
  },

  async upsertInvitation({ organizationId, email, role, status, accepted }) {
    const acceptedAt = accepted ? new Date() : undefined;
    await prisma.organizationInvitation.upsert({
      where: { organizationId_email: { organizationId, email } },
      update: { role, status, ...(acceptedAt ? { acceptedAt } : {}) },
      create: {
        organizationId,
        email,
        role,
        status,
        ...(acceptedAt ? { acceptedAt } : {}),
      },
    });
  },
};
