import { BrandMark, Card } from "@prelude/ui";
import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#fbfaf7_0%,#f6f3ec_52%,#eef0e3_100%)] px-6 py-8 text-ink-950">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl flex-col">
        <BrandMark />
        <section className="flex flex-1 items-center py-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-olive-900">
              Prelude.ai
            </p>
            <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[1.02] text-ink-950 md:text-7xl">
              First interviews, without the heavy ATS feeling.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-ink-600">
              Prelude helps recruiters create focused pre-interviews, run a
              live AI interviewer, and review candidate signals in one calm
              workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                className="inline-flex h-12 cursor-pointer items-center justify-center rounded-full border border-ink-900 bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
                href="/"
              >
                Open workspace
              </Link>
              <Link
                className="inline-flex h-12 cursor-pointer items-center justify-center rounded-full border border-ink-200 bg-white/80 px-5 text-sm font-semibold text-ink-900 transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
                href="/interviews/new"
              >
                Create interview
              </Link>
            </div>
          </div>
        </section>
        <Card className="mb-8 grid gap-5 p-5 md:grid-cols-3">
          {[
            ["Focused", "One question at a time for recruiter workflows."],
            ["Live", "Voice-first screening with candidate-friendly controls."],
            ["Reviewable", "Structured evidence before any hiring decision."],
          ].map(([title, copy]) => (
            <div key={title}>
              <h2 className="font-semibold text-ink-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">{copy}</p>
            </div>
          ))}
        </Card>
      </div>
    </main>
  );
}
