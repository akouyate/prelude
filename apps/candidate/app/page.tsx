import { CandidateShell } from "@prelude/ui";

export default function CandidateHomePage() {
  return (
    <CandidateShell>
      <div className="flex flex-1 items-center py-10">
        <section className="max-w-xl rounded-[2rem] border border-ink-100 bg-white/70 p-6 backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-olive-900">
            Candidate interview
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight text-ink-950 sm:text-4xl">
            Open the link shared by the recruiter.
          </h1>
          <p className="mt-4 text-sm leading-6 text-ink-600">
            Prelude interviews are available from a unique, published interview
            link. If you expected to start now, ask the recruiter to resend the
            invitation.
          </p>
        </section>
      </div>
    </CandidateShell>
  );
}
