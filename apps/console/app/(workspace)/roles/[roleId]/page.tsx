import { notFound } from "next/navigation";

import { InterviewOverview } from "../../../../src/features/interview-detail/interview-overview";
import { getInterviewDetail } from "../../../../src/server/interviews/interview-loaders";

type RoleDetailPageProps = {
  params: Promise<{
    roleId: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RoleDetailPage({ params }: RoleDetailPageProps) {
  const { roleId } = await params;
  const detail = await getInterviewDetail(roleId);

  if (!detail || detail.kind !== "interview") {
    notFound();
  }

  return <InterviewOverview detail={detail} />;
}
