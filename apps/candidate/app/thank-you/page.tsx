import { CandidateShell } from "@prelude/ui";

export default function ThankYouPage() {
  return (
    <CandidateShell>
      <div className="flex flex-1 items-center">
        <div>
          <h1 className="text-3xl font-semibold">Thanks for your answers.</h1>
          <p className="mt-4 text-white/72">
            The recruiter will review your pre-interview and decide the next
            step.
          </p>
        </div>
      </div>
    </CandidateShell>
  );
}
