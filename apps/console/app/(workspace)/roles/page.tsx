import {
  RolesList,
  type RoleListItem,
} from "../../../src/features/roles-list/roles-list";
import { getConsoleRolesData } from "../../../src/server/dashboard/dashboard-data";
import { parseRoleListQuery } from "../../../src/server/dashboard/list-query";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseRoleListQuery(await searchParams);
  const data = await getConsoleRolesData(query);
  const roles = data.roles.map(
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
    <RolesList
      counts={data.counts}
      nextCursor={data.nextCursor}
      organizationName={data.organizationName}
      previousCursor={data.previousCursor}
      roles={roles}
    />
  );
}
