import { CandidateShell } from "@prelude/ui";

import { LiveInterviewRoom } from "../../../src/features/live-interview/live-interview-room";

export default async function InterviewPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <CandidateShell>
      <LiveInterviewRoom token={token} />
    </CandidateShell>
  );
}
