import type { Metadata } from "next";

import { MarketingDemoLeadForm } from "../../../../src/features/marketing-demo/marketing-demo-lead-form";
import { MarketingDemoUrlCleaner } from "../../../../src/features/marketing-demo/marketing-demo-url-cleaner";
import { exchangeMarketingDemoHandoff } from "../../../../src/server/marketing-demos/marketing-demo-candidate-api";
import { buildMarketingDemoInsights } from "../../../../src/server/marketing-demos/marketing-demo-insights";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Your interview insights · HireCall",
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
    // Only these derived strings cross the server-component boundary. Raw
    // transcript and supplemental answers are consumed and deleted server-side.
    const result = buildMarketingDemoInsights(payload);
    return (
      <main className="min-h-screen bg-[#F4F3EF] px-6 py-12 text-[#151A17]">
        <MarketingDemoUrlCleaner />
        <div className="mx-auto max-w-[860px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#0F6B57]">
            Private demo result · {result.roleTitle}
          </p>
          <h1 className="mt-5 text-balance font-display text-[clamp(46px,8vw,72px)] leading-[0.98] tracking-[-0.03em]">
            Three ways to make your next answer stronger.
          </h1>
          <p className="mt-6 max-w-[620px] text-[17px] leading-[1.65] text-[#52605A]">
            Based on {result.turnCount} answer turns from the interview you just
            completed. This is practice feedback, not hiring evaluation.
          </p>

          <ol className="mt-10 grid gap-4">
            {result.insights.map((insight, index) => (
              <li
                className="rounded-[26px] border border-[#D7D9D5] bg-white p-6"
                key={insight}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#0F6B57]">
                  Insight {index + 1}
                </span>
                <p className="mt-3 font-display text-[25px] leading-[1.35]">
                  {insight}
                </p>
              </li>
            ))}
          </ol>

          <MarketingDemoLeadForm roleSlug={result.roleSlug} />
          <p className="mt-8 text-[12.5px] leading-[1.6] text-[#6E7772]">
            The one-use handoff has now been consumed. HireCall deleted the
            temporary interview transcript, follow-up answers, relay, runtime,
            and demo access record before rendering this page.
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
          This private result is no longer available.
        </h1>
        <p className="mt-5 text-[16px] leading-[1.65] text-[#52605A]">
          Handoff codes expire quickly and can be used once. No interview data
          is available from this link.
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
