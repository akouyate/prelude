import type { OrganizationRole } from "./domain-spine";

export type { OrganizationRole };

export type User = {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
};

export type OrganizationUserContext = {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: OrganizationRole;
};
