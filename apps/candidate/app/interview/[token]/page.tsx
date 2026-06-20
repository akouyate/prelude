import { CandidateShell } from "@prelude/ui";

import { LiveInterviewRoom } from "../../../src/features/live-interview/live-interview-room";
import { getPublicInterviewContext } from "../../../src/server/public-interviews";

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await getPublicInterviewContext(token);

  return (
    <CandidateShell>
      <LiveInterviewRoom context={context} token={token} />
    </CandidateShell>
  );
}
