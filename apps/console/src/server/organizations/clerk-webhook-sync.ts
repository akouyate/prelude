import type { OrganizationRole } from "@prelude/types";

import {
  readPreludeRole,
  resolveOrganizationRoleFromClerk,
} from "../../domain/clerk-role-sync";

export type ClerkWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};

/**
 * A normalized, side-effect-free description of the DB change a Clerk webhook
 * event implies. Clerk is the admin source of truth; our DB is the authZ
 * projection it syncs into. Keeping the decision pure makes the field mapping
 * (snake_case Clerk payloads) testable without a database.
 */
export type ClerkSyncIntent =
  | {
      kind: "membership";
      action: "upsert" | "remove";
      clerkOrganizationId: string;
      clerkUserId: string;
      email: string | null;
      name: string | null;
      role: OrganizationRole;
    }
  | {
      kind: "invitation";
      clerkOrganizationId: string;
      email: string;
      role: OrganizationRole;
      status: "pending" | "accepted" | "revoked";
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value);
  return raw ? raw.trim().toLowerCase() : null;
}

function composeName(first: unknown, last: unknown): string | null {
  const parts = [asString(first), asString(last)]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ") : null;
}

export function planClerkWebhookSync(
  event: ClerkWebhookEvent,
): ClerkSyncIntent | null {
  const data = asRecord(event.data) ?? {};

  switch (event.type) {
    case "organizationMembership.created":
    case "organizationMembership.updated":
    case "organizationMembership.deleted": {
      const organization = asRecord(data.organization);
      const userData = asRecord(data.public_user_data);
      const clerkOrganizationId = organization
        ? asString(organization.id)
        : null;
      const clerkUserId = userData ? asString(userData.user_id) : null;
      if (!clerkOrganizationId || !clerkUserId) {
        return null;
      }

      return {
        kind: "membership",
        action:
          event.type === "organizationMembership.deleted" ? "remove" : "upsert",
        clerkOrganizationId,
        clerkUserId,
        email: userData ? normalizeEmail(userData.identifier) : null,
        name: userData
          ? composeName(userData.first_name, userData.last_name)
          : null,
        role: resolveOrganizationRoleFromClerk({
          publicMetadataRole: readPreludeRole(data.public_metadata),
          clerkRole: asString(data.role),
        }),
      };
    }

    case "organizationInvitation.created":
    case "organizationInvitation.accepted":
    case "organizationInvitation.revoked": {
      const clerkOrganizationId = asString(data.organization_id);
      const email = normalizeEmail(data.email_address);
      if (!clerkOrganizationId || !email) {
        return null;
      }

      return {
        kind: "invitation",
        clerkOrganizationId,
        email,
        role: resolveOrganizationRoleFromClerk({
          publicMetadataRole: readPreludeRole(data.public_metadata),
          clerkRole: asString(data.role),
        }),
        status:
          event.type === "organizationInvitation.accepted"
            ? "accepted"
            : event.type === "organizationInvitation.revoked"
              ? "revoked"
              : "pending",
      };
    }

    default:
      return null;
  }
}

/**
 * The narrow persistence surface the webhook sync needs. A Prisma adapter
 * implements it for the route; tests pass a fake to assert the orchestration
 * (org-not-found skip, accepted -> acceptedAt, removal -> deactivation) without
 * a database.
 */
export interface ClerkSyncStore {
  findOrganizationIdByClerkId(
    clerkOrganizationId: string,
  ): Promise<string | null>;
  upsertUser(input: {
    clerkUserId: string;
    email: string | null;
    name: string | null;
  }): Promise<string>;
  upsertMembership(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<void>;
  deactivateMembership(input: {
    organizationId: string;
    clerkUserId: string;
  }): Promise<void>;
  upsertInvitation(input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    status: string;
    accepted: boolean;
  }): Promise<void>;
}

export type ClerkSyncResult = { applied: boolean; reason?: string };

export async function applyClerkSyncIntent(
  store: ClerkSyncStore,
  intent: ClerkSyncIntent,
): Promise<ClerkSyncResult> {
  const organizationId = await store.findOrganizationIdByClerkId(
    intent.clerkOrganizationId,
  );
  if (!organizationId) {
    // The organization has not been provisioned in our DB yet (e.g. an event
    // arrives before onboarding completes). Skip rather than fail — Clerk
    // retries, and a later membership event re-syncs the state.
    return { applied: false, reason: "organization_not_found" };
  }

  if (intent.kind === "membership") {
    if (intent.action === "remove") {
      await store.deactivateMembership({
        organizationId,
        clerkUserId: intent.clerkUserId,
      });
      return { applied: true };
    }

    const userId = await store.upsertUser({
      clerkUserId: intent.clerkUserId,
      email: intent.email,
      name: intent.name,
    });
    await store.upsertMembership({
      organizationId,
      userId,
      role: intent.role,
    });
    return { applied: true };
  }

  await store.upsertInvitation({
    organizationId,
    email: intent.email,
    role: intent.role,
    status: intent.status,
    accepted: intent.status === "accepted",
  });
  return { applied: true };
}
