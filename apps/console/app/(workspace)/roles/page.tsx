import {
  RolesList,
  type RoleListItem,
} from "../../../src/features/roles-list/roles-list";
import { getConsoleDashboardData } from "../../../src/server/dashboard/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RolesPage() {
  const dashboard = await getConsoleDashboardData();
  const roles = dashboard.roles.map(
    (role): RoleListItem => ({
      candidateCount: role.candidateCount,
      candidatePath: role.candidatePath,
      href: role.href,
      id: role.id,
      location: role.location,
      sourceProvider: role.sourceProvider,
      state: role.state,
      title: role.title,
      updatedAt: role.updatedAt,
    }),
  );

  return (
    <RolesList organizationName={dashboard.organization.name} roles={roles} />
  );
}
