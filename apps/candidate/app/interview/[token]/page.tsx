import { Button, CandidateShell } from "@prelude/ui";
import { Mic, ShieldCheck } from "lucide-react";

export default async function InterviewPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <CandidateShell>
      <section className="flex flex-1 flex-col justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-sm bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Private pre-interview
          </div>
          <h1 className="mt-8 text-3xl font-semibold leading-tight">
            Three short questions before the recruiter call.
          </h1>
          <p className="mt-4 text-base leading-7 text-white/72">
            Answer by voice, video, or text. The recruiter reviews your content,
            not your face, accent, tone, or emotion.
          </p>
        </div>

        <div className="mt-10 rounded-lg bg-white p-4 text-ink-900 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-meadow-100 p-2 text-meadow-700">
              <Mic aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Demo token</p>
              <p className="mt-1 break-all text-sm text-ink-600">{token}</p>
            </div>
          </div>
          <Button className="mt-5 w-full">Start pre-interview</Button>
        </div>
      </section>
    </CandidateShell>
  );
}
