import type { Metadata } from "next";

import { MarketingDemoLeadForm } from "../../../../src/features/marketing-demo/marketing-demo-lead-form";
import { MarketingDemoSyntheticBrief } from "../../../../src/features/marketing-demo/marketing-demo-synthetic-brief";
import { MarketingDemoUrlCleaner } from "../../../../src/features/marketing-demo/marketing-demo-url-cleaner";
import { exchangeMarketingDemoHandoff } from "../../../../src/server/marketing-demos/marketing-demo-candidate-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Demo complete · HireCall",
};

export default async function MarketingDemoResultPage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string }>;
}) {
  const { handoff } = await searchParams;
  const returnTarget = new URL(
    "/demo/result",
    process.env.NEXT_PUBLIC_CONSOLE_URL ?? "http://localhost:3000",
  ).toString();

  if (!handoff) {
    return <UnavailableResult />;
  }

  try {
    const payload = await exchangeMarketingDemoHandoff({
      code: handoff,
      returnTarget,
    });
    return (
      <main className="min-h-screen bg-[#F4F3EF] px-6 py-12 text-[#151A17]">
        <MarketingDemoUrlCleaner />
        <div className="mx-auto max-w-[860px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#0F6B57]">
            Demo completed · {payload.roleTitle}
          </p>
          <h1 className="mt-5 text-balance font-display text-[clamp(46px,8vw,72px)] leading-[0.98] tracking-[-0.03em]">
            You tried the candidate experience. Now run it on your own role.
          </h1>
          <p className="mt-6 max-w-[620px] text-[17px] leading-[1.65] text-[#52605A]">
            Your interview data has been deleted. The next step is to create a
            real interview for your hiring team and review structured evidence
            from your own candidates.
          </p>
          <MarketingDemoLeadForm captureToken={payload.leadCaptureToken} />
          <p className="mt-4 text-[13px] text-[#52605A]">
            Prefer to start now?{" "}
            <a className="font-medium underline" href="/sign-up">
              Create your HireCall account
            </a>
            .
          </p>
          <MarketingDemoSyntheticBrief roleSlug={payload.roleSlug} />
          <p className="mt-8 text-[12.5px] leading-[1.6] text-[#6E7772]">
            The one-use handoff contained only demo completion and predefined
            role metadata. A separate short-lived proof allows one email setup
            request. HireCall deleted the temporary transcript before the
            redirect, then consumed the relay and deleted the demo runtime
            before rendering this page.
          </p>
        </div>
      </main>
    );
  } catch {
    return <UnavailableResult />;
  }
}

function UnavailableResult() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F4F3EF] px-6 text-center text-[#151A17]">
      <div className="max-w-[520px]">
        <h1 className="font-display text-[48px] leading-[1.02]">
          This demo return is no longer available.
        </h1>
        <p className="mt-5 text-[16px] leading-[1.65] text-[#52605A]">
          Handoff codes expire quickly and can be used once. Start a new demo to
          try the candidate experience again.
        </p>
        <a
          className="mt-8 inline-flex rounded-full bg-[#0B4B3E] px-6 py-3 font-title font-medium text-white"
          href="/demo"
        >
          Return to demo roles
        </a>
      </div>
    </main>
  );
}
