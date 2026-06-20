import { CandidateShell } from "@prelude/ui";

export default function ThankYouPage() {
  return (
    <CandidateShell>
      <div className="flex flex-1 items-center py-10">
        <div className="max-w-xl rounded-[2rem] border border-ink-100 bg-white/70 p-6 backdrop-blur">
          <h1 className="text-4xl font-semibold text-ink-950">
            Thanks for your answers.
          </h1>
          <p className="mt-4 text-sm leading-6 text-ink-600">
            Your answers were sent for recruiter review. The hiring team will
            follow up with the next step.
          </p>
        </div>
      </div>
    </CandidateShell>
  );
}
