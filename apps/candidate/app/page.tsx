import {
  CandidateMonoPill,
  CandidateScreenHeader,
  CandidateShell,
  CandidateWordmark,
} from "@prelude/ui";

export default function CandidateHomePage() {
  return (
    <CandidateShell>
      <CandidateScreenHeader
        left={<CandidateWordmark className="h-[23px]" />}
        right={<CandidateMonoPill>Candidate interview</CandidateMonoPill>}
      />
      <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-[4.5rem] pt-6">
        <section className="w-full max-w-[520px] text-center">
          <h1 className="font-display text-[clamp(32px,5vw,46px)] font-normal leading-[1.05] tracking-[-0.02em] text-ink-950">
            Open the link shared by the recruiter.
          </h1>
          <p className="mx-auto mt-4 max-w-[30rem] text-pretty text-[16px] leading-[1.62] text-ink-700">
            HireCall interviews are available from a unique, published interview
            link. If you expected to start now, ask the recruiter to resend the
            invitation.
          </p>
        </section>
      </div>
    </CandidateShell>
  );
}
