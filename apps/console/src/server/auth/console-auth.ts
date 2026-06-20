import "server-only";

import type { OrganizationUserContext } from "@prelude/types";

import { getConsoleAuthIdentity } from "./console-auth-provider";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export async function getConsoleAuthContext(): Promise<OrganizationUserContext> {
  const identity = await getConsoleAuthIdentity();

  if (!identity.ok) {
    throw new Error(identity.error);
  }

  const scope = await getCompletedOrganizationScope();

  return {
    organizationId: scope.organizationId,
    organizationName: scope.organizationName,
    userEmail: identity.value.userEmail,
    userId: scope.userId,
    userName: identity.value.userName,
    role: scope.role,
  };
}
