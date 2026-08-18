import { describe, expect, it, vi } from "vitest";

import {
  applyClerkSyncIntent,
  planClerkWebhookSync,
  type ClerkSyncIntent,
  type ClerkSyncStore,
} from "./clerk-webhook-sync";

describe("planClerkWebhookSync", () => {
  it("plans an active membership upsert from organizationMembership.created", () => {
    const intent = planClerkWebhookSync({
      type: "organizationMembership.created",
      data: {
        organization: { id: "org_clerk_1" },
        public_user_data: {
          user_id: "user_clerk_1",
          identifier: "ada@example.com",
          first_name: "Ada",
          last_name: "Lovelace",
        },
        role: "org:admin",
        public_metadata: {},
      },
    });

    expect(intent).toEqual({
      kind: "membership",
      action: "upsert",
      clerkOrganizationId: "org_clerk_1",
      clerkUserId: "user_clerk_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      role: "admin",
    });
  });

  it("prefers the granular preludeRole carried in membership public_metadata", () => {
    const intent = planClerkWebhookSync({
      type: "organizationMembership.updated",
      data: {
        organization: { id: "org_clerk_1" },
        public_user_data: {
          user_id: "user_clerk_2",
          identifier: "viewer@example.com",
          first_name: "Vee",
          last_name: null,
        },
        role: "org:admin",
        public_metadata: { preludeRole: "viewer" },
      },
    });

    expect(intent).toMatchObject({
      kind: "membership",
      action: "upsert",
      clerkUserId: "user_clerk_2",
      name: "Vee",
      role: "viewer",
    });
  });

  it("plans a membership removal from organizationMembership.deleted", () => {
    const intent = planClerkWebhookSync({
      type: "organizationMembership.deleted",
      data: {
        organization: { id: "org_clerk_1" },
        public_user_data: { user_id: "user_clerk_1", identifier: "ada@example.com" },
        role: "org:member",
      },
    });

    expect(intent).toMatchObject({
      kind: "membership",
      action: "remove",
      clerkOrganizationId: "org_clerk_1",
      clerkUserId: "user_clerk_1",
    });
  });

  it("plans a pending invitation from organizationInvitation.created", () => {
    const intent = planClerkWebhookSync({
      type: "organizationInvitation.created",
      data: {
        organization_id: "org_clerk_1",
        email_address: "New@Example.com",
        role: "org:member",
        status: "pending",
        public_metadata: { preludeRole: "recruiter" },
      },
    });

    expect(intent).toEqual({
      kind: "invitation",
      clerkOrganizationId: "org_clerk_1",
      email: "new@example.com",
      role: "recruiter",
      status: "pending",
    });
  });

  it("maps invitation.accepted and invitation.revoked to their statuses", () => {
    expect(
      planClerkWebhookSync({
        type: "organizationInvitation.accepted",
        data: {
          organization_id: "org_clerk_1",
          email_address: "new@example.com",
          role: "org:member",
          public_metadata: { preludeRole: "recruiter" },
        },
      }),
    ).toMatchObject({ kind: "invitation", status: "accepted", role: "recruiter" });

    expect(
      planClerkWebhookSync({
        type: "organizationInvitation.revoked",
        data: {
          organization_id: "org_clerk_1",
          email_address: "new@example.com",
          role: "org:member",
        },
      }),
    ).toMatchObject({ kind: "invitation", status: "revoked" });
  });

  it("ignores unrelated events", () => {
    expect(
      planClerkWebhookSync({ type: "organization.created", data: { id: "org_x" } }),
    ).toBeNull();
  });

  it("plans a user profile sync from user.updated, matched by clerkUserId", () => {
    const intent = planClerkWebhookSync({
      type: "user.updated",
      data: {
        id: "user_clerk_1",
        first_name: "Ada",
        last_name: "Lovelace",
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "Ada@Example.com" }],
      },
    });

    expect(intent).toEqual({
      kind: "user",
      clerkUserId: "user_clerk_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
  });

  it("selects the PRIMARY email even when it is not first in email_addresses[]", () => {
    const intent = planClerkWebhookSync({
      type: "user.updated",
      data: {
        id: "user_clerk_1",
        first_name: "Ada",
        last_name: "Lovelace",
        primary_email_address_id: "idn_2",
        email_addresses: [
          { id: "idn_1", email_address: "old@example.com" },
          { id: "idn_2", email_address: "primary@example.com" },
        ],
      },
    });

    expect(intent).toMatchObject({ email: "primary@example.com" });
  });

  it("ignores a stale/removed email address even if it is listed first", () => {
    const intent = planClerkWebhookSync({
      type: "user.updated",
      data: {
        id: "user_clerk_1",
        primary_email_address_id: "idn_missing",
        email_addresses: [{ id: "idn_1", email_address: "old@example.com" }],
      },
    });

    expect(intent).toMatchObject({ email: null });
  });

  it("round-trips a single-word name our own form produced without mutating it", () => {
    // updateProfileNameAction's splitDisplayName("Ada") sends Clerk
    // { firstName: "Ada", lastName: "" } (explicit empty string, not
    // undefined, so a shortened name actually clears Clerk's last_name).
    // Clerk echoes that back verbatim in user.updated; composeName must
    // recompose it back to "Ada", not "Ada " or null.
    const intent = planClerkWebhookSync({
      type: "user.updated",
      data: {
        id: "user_clerk_1",
        first_name: "Ada",
        last_name: "",
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "ada@example.com" }],
      },
    });

    expect(intent).toMatchObject({ name: "Ada" });
  });

  it("is a safe no-op for user.created and user.deleted (see code comments for rationale)", () => {
    expect(
      planClerkWebhookSync({ type: "user.created", data: { id: "user_x" } }),
    ).toBeNull();
    expect(
      planClerkWebhookSync({ type: "user.deleted", data: { id: "user_x" } }),
    ).toBeNull();
  });

  it("still ignores a wholly unknown event type", () => {
    expect(
      planClerkWebhookSync({ type: "session.created", data: { id: "sess_x" } }),
    ).toBeNull();
  });

  it("plans subscription and subscription-item events as canonical billing refreshes", () => {
    expect(
      planClerkWebhookSync({
        type: "subscription.updated",
        data: {
          payer: { organization_id: "org_clerk_1" },
          updated_at: Date.parse("2026-07-24T10:00:00.000Z"),
        },
      }),
    ).toEqual({
      kind: "billing",
      clerkOrganizationId: "org_clerk_1",
      sourceUpdatedAt: new Date("2026-07-24T10:00:00.000Z"),
    });

    expect(
      planClerkWebhookSync({
        type: "subscriptionItem.canceled",
        data: {
          organization_id: "org_clerk_1",
          updated_at: Date.parse("2026-07-24T11:00:00.000Z"),
        },
      }),
    ).toMatchObject({
      kind: "billing",
      clerkOrganizationId: "org_clerk_1",
    });
  });
});

function fakeStore(overrides: Partial<ClerkSyncStore> = {}): ClerkSyncStore {
  return {
    findOrganizationIdByClerkId: vi.fn(async () => "org_db_1"),
    upsertUser: vi.fn(async () => "user_db_1"),
    upsertMembership: vi.fn(async () => {}),
    deactivateMembership: vi.fn(async () => {}),
    upsertInvitation: vi.fn(async () => {}),
    updateUserProfile: vi.fn(async () => true),
    ...overrides,
  };
}

const membershipUpsert: ClerkSyncIntent = {
  kind: "membership",
  action: "upsert",
  clerkOrganizationId: "org_clerk_1",
  clerkUserId: "user_clerk_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  role: "admin",
};

describe("applyClerkSyncIntent", () => {
  it("provisions the user then upserts the membership with its resolved role", async () => {
    const store = fakeStore();
    const result = await applyClerkSyncIntent(store, membershipUpsert);

    expect(result.applied).toBe(true);
    expect(store.upsertUser).toHaveBeenCalledWith({
      clerkUserId: "user_clerk_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(store.upsertMembership).toHaveBeenCalledWith({
      organizationId: "org_db_1",
      userId: "user_db_1",
      role: "admin",
    });
  });

  it("skips (does not mutate) when the organization is not yet provisioned", async () => {
    const store = fakeStore({
      findOrganizationIdByClerkId: vi.fn(async () => null),
    });
    const result = await applyClerkSyncIntent(store, membershipUpsert);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("organization_not_found");
    expect(store.upsertUser).not.toHaveBeenCalled();
    expect(store.upsertMembership).not.toHaveBeenCalled();
  });

  it("deactivates the membership on a removal intent", async () => {
    const store = fakeStore();
    const result = await applyClerkSyncIntent(store, {
      ...membershipUpsert,
      action: "remove",
    });

    expect(result.applied).toBe(true);
    expect(store.deactivateMembership).toHaveBeenCalledWith({
      organizationId: "org_db_1",
      clerkUserId: "user_clerk_1",
    });
    expect(store.upsertMembership).not.toHaveBeenCalled();
  });

  it("upserts an accepted invitation with the accepted flag set", async () => {
    const store = fakeStore();
    const result = await applyClerkSyncIntent(store, {
      kind: "invitation",
      clerkOrganizationId: "org_clerk_1",
      email: "new@example.com",
      role: "recruiter",
      status: "accepted",
    });

    expect(result.applied).toBe(true);
    expect(store.upsertInvitation).toHaveBeenCalledWith({
      organizationId: "org_db_1",
      email: "new@example.com",
      role: "recruiter",
      status: "accepted",
      accepted: true,
    });
  });

  it("updates an existing user's mirrored name/email by clerkUserId, without any org lookup", async () => {
    const store = fakeStore();
    const result = await applyClerkSyncIntent(store, {
      kind: "user",
      clerkUserId: "user_clerk_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });

    expect(result.applied).toBe(true);
    expect(store.updateUserProfile).toHaveBeenCalledWith({
      clerkUserId: "user_clerk_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    expect(store.findOrganizationIdByClerkId).not.toHaveBeenCalled();
  });

  it("is a safe no-op when the clerkUserId is unknown to us: no throw, no row created", async () => {
    const store = fakeStore({
      updateUserProfile: vi.fn(async () => false),
    });
    const result = await applyClerkSyncIntent(store, {
      kind: "user",
      clerkUserId: "user_unknown",
      email: "ghost@example.com",
      name: "Ghost",
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("user_not_found");
    expect(store.upsertUser).not.toHaveBeenCalled();
  });
});
