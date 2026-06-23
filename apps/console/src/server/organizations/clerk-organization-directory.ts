import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import {
  preludeRoleMetadata,
  readPreludeRole,
  resolveOrganizationRoleFromClerk,
  toClerkMembershipRole,
} from "../../domain/clerk-role-sync";
import type {
  OrganizationDirectory,
  PendingInvitation,
} from "./team-management";

/**
 * Live OrganizationDirectory backed by the Clerk Backend API. Clerk owns the
 * invitation lifecycle (and sends the invite email); team-management.ts holds
 * the permission gating. Clerk's coarse role is set for its own dashboard, with
 * our granular role mirrored into publicMetadata.
 */
export const clerkOrganizationDirectory: OrganizationDirectory = {
  async inviteMember({ clerkOrganizationId, email, role, inviterUserId }) {
    const client = await clerkClient();
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: clerkOrganizationId,
      emailAddress: email,
      role: toClerkMembershipRole(role),
      inviterUserId,
      publicMetadata: preludeRoleMetadata(role),
    });
    return { id: invitation.id };
  },

  async listPendingInvitations(clerkOrganizationId) {
    const client = await clerkClient();
    const { data } = await client.organizations.getOrganizationInvitationList({
      organizationId: clerkOrganizationId,
      status: ["pending"],
    });
    return data.map(
      (invitation): PendingInvitation => ({
        id: invitation.id,
        email: invitation.emailAddress,
        role: resolveOrganizationRoleFromClerk({
          publicMetadataRole: readPreludeRole(invitation.publicMetadata),
          clerkRole: invitation.role,
        }),
      }),
    );
  },

  async revokeInvitation({ clerkOrganizationId, invitationId, requesterUserId }) {
    const client = await clerkClient();
    await client.organizations.revokeOrganizationInvitation({
      organizationId: clerkOrganizationId,
      invitationId,
      requestingUserId: requesterUserId,
    });
  },

  async getMemberRole({ clerkOrganizationId, userId }) {
    const client = await clerkClient();
    const { data } = await client.organizations.getOrganizationMembershipList({
      organizationId: clerkOrganizationId,
      userId: [userId],
      limit: 1,
    });
    const membership = data[0];
    if (!membership) {
      return null;
    }
    return resolveOrganizationRoleFromClerk({
      publicMetadataRole: readPreludeRole(membership.publicMetadata),
      clerkRole: membership.role,
    });
  },

  async setMemberRole({ clerkOrganizationId, userId, role }) {
    const client = await clerkClient();
    // Two independent writes to the same membership — overlap their latency.
    await Promise.all([
      client.organizations.updateOrganizationMembership({
        organizationId: clerkOrganizationId,
        userId,
        role: toClerkMembershipRole(role),
      }),
      client.organizations.updateOrganizationMembershipMetadata({
        organizationId: clerkOrganizationId,
        userId,
        publicMetadata: preludeRoleMetadata(role),
      }),
    ]);
  },

  async removeMember({ clerkOrganizationId, userId }) {
    const client = await clerkClient();
    await client.organizations.deleteOrganizationMembership({
      organizationId: clerkOrganizationId,
      userId,
    });
  },
};
