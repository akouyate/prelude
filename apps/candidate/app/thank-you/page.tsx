import {
  CandidateScreenHeader,
  CandidateShell,
  CandidateWordmark,
} from "@prelude/ui";

export default function ThankYouPage() {
  return (
    <CandidateShell>
      <CandidateScreenHeader left={<CandidateWordmark />} />
      <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-[4.5rem] pt-6">
        <div className="w-full max-w-[520px] text-center">
          <h1 className="font-display text-[clamp(32px,5vw,46px)] font-normal leading-[1.05] tracking-[-0.02em] text-ink-950">
            Thanks for your answers.
          </h1>
          <p className="mx-auto mt-4 max-w-[30rem] text-pretty text-[16px] leading-[1.62] text-ink-700">
            Your answers were sent for recruiter review. The hiring team will
            follow up with the next step.
          </p>
        </div>
      </div>
    </CandidateShell>
  );
}
