import type { Metadata } from "next";
import { CandidateShell, CandidateWordmark } from "@prelude/ui";

import { getCandidateExperiencePreviewContext } from "../../../../src/server/candidate-experience-previews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Demo interview privacy notice · HireCall",
};

export default async function MarketingDemoPrivacyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await getCandidateExperiencePreviewContext(token);
  const marketingDemo =
    context.kind === "preview" && context.previewVariant === "marketing_demo"
      ? context.marketingDemo
      : null;
  const voiceProcessor = process.env.LIVE_INTERVIEW_PROVIDER?.includes(
    "elevenlabs",
  )
    ? "ElevenLabs"
    : "OpenAI";

  return (
    <CandidateShell>
      <header className="px-6 py-5">
        <CandidateWordmark />
      </header>
      <main className="mx-auto w-full max-w-[720px] px-6 pb-20 pt-6 text-ink-700">
        {marketingDemo ? (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-spruce-700">
              Public demo privacy notice
            </p>
            <h1 className="mt-4 font-display text-[clamp(36px,7vw,56px)] leading-[1.04] text-ink-950">
              What happens to your interview data
            </h1>
            <div className="mt-8 space-y-6 text-[16px] leading-[1.7]">
              <p>
                HireCall is the controller for this public product demo. Your
                microphone audio is transmitted live through LiveKit and sent to{" "}
                {voiceProcessor}, the configured AI voice processor, so the
                interviewer can hear and respond to you. Audio recording and
                video are disabled.
              </p>
              <p>
                A text transcript is processed and stored temporarily in
                HireCall&apos;s realtime service while the demo runs. After you
                finish, the transcript and your follow-up answers are encrypted
                for a single server-to-server handoff to the HireCall website.
                The relay is usable once and expires within five minutes.
              </p>
              <p>
                After a successful handoff, the relay, transcript events, demo
                runtime row, and access token digest are deleted immediately.
                The relay expires after five minutes. An abandoned interview has
                a server-enforced twelve-minute runtime ceiling, and the
                five-minute cleanup sweep removes its temporary runtime data.
              </p>
              <p>
                No candidate profile, recruiter brief, customer billing charge,
                recruiter notification, recording, or resume token is created.
                Interview processing consent is required to use the demo. Any
                later request for marketing email is separate and optional.
              </p>
              <p>
                Consent is the legal basis for this interview processing. You
                can withdraw it at any time by using Quit; live processing then
                stops and the temporary data follows the deletion windows above.
                This practice result is not a hiring decision or candidate
                evaluation.
              </p>
              <p>
                To request access or earlier erasure, or to ask a privacy
                question, email privacy@hirecall.ai. You may also complain to
                the CNIL or your local data-protection authority.
              </p>
            </div>
            <a
              className="mt-9 inline-flex rounded-full bg-spruce-800 px-6 py-3 font-title font-medium text-white"
              href={`/preview/${encodeURIComponent(token)}`}
            >
              Return to the demo
            </a>
          </>
        ) : (
          <>
            <h1 className="font-display text-4xl text-ink-950">
              Notice unavailable
            </h1>
            <p className="mt-4">This demo link is invalid or has expired.</p>
          </>
        )}
      </main>
    </CandidateShell>
  );
}
