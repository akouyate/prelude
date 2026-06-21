import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LegacyNewInterviewPageProps = {
  searchParams: Promise<{
    draftId?: string;
    jobId?: string;
  }>;
};

export default async function LegacyNewInterviewPage({
  searchParams,
}: LegacyNewInterviewPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();

  if (params.draftId) {
    query.set("draftId", params.draftId);
  }

  if (params.jobId) {
    query.set("jobId", params.jobId);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(`/roles/new${suffix}`);
}
