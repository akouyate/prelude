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
    }
  | {
      kind: "user";
      clerkUserId: string;
      email: string | null;
      name: string | null;
    };

export type ClerkBillingSyncIntent = {
  kind: "billing";
  clerkOrganizationId: string;
  sourceUpdatedAt: Date | undefined;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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

// A Clerk user carries every email address they've ever added; only one is
// PRIMARY (`primary_email_address_id`), and it is not necessarily
// `email_addresses[0]` — a user can add a new address and only later make it
// primary, or reorder is not guaranteed at all. Picking `[0]` would silently
// swap a person's mirrored email for an address they never asked to log in
// with. Falls back to null (leave the mirror untouched) if the primary id
// doesn't resolve to a listed address, rather than guessing.
function selectPrimaryEmail(data: Record<string, unknown>): string | null {
  const primaryId = asString(data.primary_email_address_id);
  if (!primaryId) {
    // No primary id at all is a normal shape (e.g. a user.updated payload
    // that doesn't touch email) — nothing worth flagging.
    return null;
  }
  const addresses = Array.isArray(data.email_addresses)
    ? data.email_addresses
    : [];
  const primary = addresses
    .map((entry) => asRecord(entry))
    .find((entry) => entry && asString(entry.id) === primaryId);
  if (!primary) {
    // Unlike the branch above, an id being PRESENT but not resolving to any
    // listed address should never happen for a well-formed Clerk payload —
    // it is a version-skew/bug signal worth surfacing, not a normal shape.
    // Still returns null rather than throwing: a resolvable `name` in the
    // same event should still apply, and treating a malformed event as fatal
    // would make it retry pointlessly through Svix's ~27.5h/8-attempt retry
    // schedule (docs.svix.com/retries) on a defect no retry can fix.
    console.warn(
      "[clerk-webhook] user.updated: primary_email_address_id did not resolve to any listed email_addresses entry",
      primaryId,
    );
    return null;
  }
  return normalizeEmail(primary.email_address);
}

export function planClerkWebhookSync(
  event: ClerkWebhookEvent,
): ClerkSyncIntent | ClerkBillingSyncIntent | null {
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

    case "user.updated": {
      const clerkUserId = asString(data.id);
      if (!clerkUserId) {
        return null;
      }
      // No ordering guard: two rapid user.updated events landing out of
      // order leave the OLDER name/email persisted, with nothing to
      // self-correct until the next update arrives. Acceptable to ship —
      // this is display data, not authZ or money — but unlike every other
      // deliberate omission in this file, fixing it needs a new column (a
      // `sourceUpdatedAt` guard, the same pattern as
      // packages/billing/src/server.ts:293,313's
      // `sourceUpdatedAt: { lte: … }`) and therefore a migration, which is
      // out of scope for this wave.
      return {
        kind: "user",
        clerkUserId,
        email: selectPrimaryEmail(data),
        name: composeName(data.first_name, data.last_name),
      };
    }

    case "user.created": {
      // Deliberately not implemented. A brand-new Clerk user with no
      // organization membership yet has no attachment point in our schema —
      // `User` only relates to an org through `OrganizationMembership`
      // (packages/db/prisma/schema.prisma:49-79), and this event carries no
      // org context at all. Real users are already lazily provisioned, WITH
      // org context, by organizationMembership.created/updated (the
      // "membership" case above) the moment they're actually added to an
      // org. Handling user.created here would either duplicate that
      // provisioning or create an orphaned User row nothing ever attaches
      // to. Safe no-op by design, not an oversight.
      return null;
    }

    case "user.deleted": {
      // Deliberately not a hard delete. `User` is referenced by
      // CandidateSessionReviewEvent, CandidateScheduledCall, CandidateSession
      // review authorship, RoleIntake, CandidateExperiencePreview and
      // OrganizationMembership (packages/db/prisma/schema.prisma:49-79) — a
      // delete/cascade here would orphan or destroy real product history for
      // an event we can't undo. A proper erasure flow needs a product
      // decision on what "delete" means for a referenced identity
      // (anonymize the row vs. retain-with-a-tombstone flag vs. something
      // else) plus a migration; that's out of scope here. Safe no-op.
      return null;
    }

    default: {
      if (isClerkBillingEvent(event.type)) {
        const payer = asRecord(data.payer);
        const clerkOrganizationId =
          asString(data.organization_id) ??
          (payer ? asString(payer.organization_id) : null);
        if (!clerkOrganizationId) {
          return null;
        }
        return {
          kind: "billing",
          clerkOrganizationId,
          sourceUpdatedAt: asDate(data.updated_at),
        };
      }
      return null;
    }
  }
}

function isClerkBillingEvent(type: string) {
  return type.startsWith("subscription.") || type.startsWith("subscriptionItem.");
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
  /**
   * Mirror a `user.updated` profile change onto an EXISTING row, matched by
   * `clerkUserId`. Unlike `upsertUser`, this never creates a row — a
   * `user.*` event carries no organization context, so provisioning stays
   * the job of the membership sync above. Returns false (and does nothing)
   * when no row matches, so an unknown/not-yet-provisioned Clerk user is a
   * safe no-op rather than an orphaned insert.
   */
  updateUserProfile(input: {
    clerkUserId: string;
    email: string | null;
    name: string | null;
  }): Promise<boolean>;
}

export type ClerkSyncResult = { applied: boolean; reason?: string };

export async function applyClerkSyncIntent(
  store: ClerkSyncStore,
  intent: ClerkSyncIntent,
): Promise<ClerkSyncResult> {
  if (intent.kind === "user") {
    // No organization in this intent at all (a `user.*` event is not
    // org-scoped) — go straight to the profile mirror, and never create a
    // row for a Clerk user we don't already know about.
    const applied = await store.updateUserProfile({
      clerkUserId: intent.clerkUserId,
      email: intent.email,
      name: intent.name,
    });
    return applied
      ? { applied: true }
      : { applied: false, reason: "user_not_found" };
  }

  const organizationId = await store.findOrganizationIdByClerkId(
    intent.clerkOrganizationId,
  );
  if (!organizationId) {
    // The organization has not been provisioned in our DB yet (e.g. an event
    // arrives before onboarding completes). This is a "reason", not a
    // silent success — the caller (route.ts) MUST turn `applied: false` here
    // into a non-2xx response. Svix does NOT redeliver a 2xx, and there is
    // no later event that re-syncs a static membership on its own, so
    // acknowledging this with 200 acknowledges the event and drops it
    // forever (a previous version of this comment claimed otherwise; both
    // halves of that claim were false).
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
