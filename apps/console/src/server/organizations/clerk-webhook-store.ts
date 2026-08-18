import "server-only";

import { Prisma, prisma } from "@prelude/db";

import type { ClerkSyncStore } from "./clerk-webhook-sync";

function isUniqueConstraintViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

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
        select: { id: true, clerkUserId: true },
      });
      if (byEmail) {
        if (byEmail.clerkUserId) {
          // This row is already linked to a DIFFERENT Clerk identity (we
          // already know it isn't THIS clerkUserId — that lookup above came
          // back empty). Two Clerk accounts can share an email (an email
          // change, an instance migration, a delete + re-signup); silently
          // reassigning clerkUserId here would hand the second account
          // every OrganizationMembership the first one held. Fail loudly
          // instead of guessing — this throws, so Svix retries the event,
          // which is exactly as unproductive as it should be until a human
          // resolves the collision.
          throw new Error(
            `Cannot provision Clerk user ${clerkUserId}: email ${email} already ` +
              `belongs to user ${byEmail.id}, which is linked to a different ` +
              `Clerk identity (${byEmail.clerkUserId}). Refusing to reassign it.`,
          );
        }
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
    await prisma.organizationMembership.updateMany({
      where: { organizationId, user: { clerkUserId } },
      data: { status: "inactive" },
    });
  },

  async updateUserProfile({ clerkUserId, email, name }) {
    const existing = await prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
    if (!existing) {
      // Not a row we know about (e.g. they haven't joined an org yet, so no
      // membership event has provisioned them). Nothing to mirror onto.
      return false;
    }

    const data: { email?: string; name?: string } = {};
    if (email) data.email = email;
    if (name) data.name = name;
    if (Object.keys(data).length === 0) {
      return true;
    }

    try {
      await prisma.user.update({ where: { id: existing.id }, data });
    } catch (error) {
      if (!data.email || !isUniqueConstraintViolation(error)) {
        throw error;
      }
      // The new email already belongs to a DIFFERENT User row — a Clerk
      // user changed their email to one another account already holds.
      // Retrying this event would hit the exact same P2002 forever until
      // Svix disables the endpoint, taking every OTHER sync down with it
      // (see item 4's related note in the hardening brief). Park it: apply
      // whatever isn't in conflict (the name), log it for a human to
      // reconcile the two rows, and report success so the event stops
      // retrying — a retry cannot fix a collision only a human can resolve.
      console.error(
        "[clerk-webhook] user.updated: email collision, parked",
        clerkUserId,
        email,
      );
      const { email: _conflictingEmail, ...rest } = data;
      if (Object.keys(rest).length > 0) {
        await prisma.user.update({ where: { id: existing.id }, data: rest });
      }
    }
    return true;
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
