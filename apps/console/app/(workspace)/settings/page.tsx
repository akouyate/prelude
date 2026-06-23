import { WorkspaceSettings } from "../../../src/features/settings/workspace-settings";
import { getWorkspaceSettingsData } from "../../../src/server/settings/workspace-settings-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WorkspaceSettingsPage() {
  const data = await getWorkspaceSettingsData();

  return <WorkspaceSettings data={data} />;
}
