import type { Metadata } from "next";
import { CandidateShell } from "@prelude/ui";

import { LiveInterviewRoom } from "../../../src/features/live-interview/live-interview-room";
import { CandidatePreviewToolbar } from "../../../src/features/live-interview/candidate-preview-toolbar";
import { getCandidateExperiencePreviewContext } from "../../../src/server/candidate-experience-previews";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const context = await getCandidateExperiencePreviewContext(token);
  return {
    referrer: "no-referrer",
    robots: { follow: false, index: false },
    title:
      context.kind !== "published" &&
      context.previewVariant === "marketing_demo"
        ? "Live demo interview · HireCall"
        : "Candidate experience preview · HireCall",
  };
}

export default async function CandidatePreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await getCandidateExperiencePreviewContext(token);

  return (
    <CandidateShell>
      {context.kind === "preview" &&
      context.previewVariant === "recruiter_preview" ? (
        <CandidatePreviewToolbar returnPath={context.returnPath} />
      ) : null}
      <LiveInterviewRoom context={context} token={token} />
    </CandidateShell>
  );
}
