import { CandidateShell } from "@prelude/ui";

export default function CandidateHomePage() {
  return (
    <CandidateShell>
      <div className="flex flex-1 items-center">
        <section className="rounded-3xl border border-white/10 bg-white/8 p-6 backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/52">
            Candidate interview
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight">
            Open the link shared by the recruiter.
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/72">
            Prelude interviews are available from a unique, published interview
            link. If you expected to start now, ask the recruiter to resend the
            invitation.
          </p>
        </section>
      </div>
    </CandidateShell>
  );
}
