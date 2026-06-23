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
      planClerkWebhookSync({ type: "user.created", data: { id: "user_x" } }),
    ).toBeNull();
    expect(
      planClerkWebhookSync({ type: "organization.created", data: { id: "org_x" } }),
    ).toBeNull();
  });
});

function fakeStore(overrides: Partial<ClerkSyncStore> = {}): ClerkSyncStore {
  return {
    findOrganizationIdByClerkId: vi.fn(async () => "org_db_1"),
    upsertUser: vi.fn(async () => "user_db_1"),
    upsertMembership: vi.fn(async () => {}),
    deactivateMembership: vi.fn(async () => {}),
    upsertInvitation: vi.fn(async () => {}),
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
});
