import type { Metadata } from "next";

import { withdrawMarketingDemoLeadAction } from "../../../../src/server/marketing-demos/marketing-demo-lead-actions";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Marketing preferences · HireCall",
};

export default async function MarketingDemoUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; token?: string }>;
}) {
  const { status, token } = await searchParams;

  if (status === "withdrawn") {
    return (
      <Message
        title="You are unsubscribed."
        body="HireCall will no longer send marketing-demo updates to this address."
      />
    );
  }
  if (status === "invalid") {
    return (
      <Message
        title="This link is not valid."
        body="Use the unsubscribe link from the most recent HireCall message."
      />
    );
  }
  if (status === "unavailable") {
    return (
      <Message
        title="We could not update your preference."
        body="Please retry shortly or contact privacy@hirecall.ai."
      />
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#F4F3EF] px-6 text-[#151A17]">
      <div className="w-full max-w-[560px] rounded-[28px] border border-[#D7D9D5] bg-white p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#0F6B57]">
          Marketing preferences
        </p>
        <h1 className="mt-4 font-display text-[46px] leading-[1.02]">
          Stop HireCall product updates?
        </h1>
        <p className="mt-5 text-[15px] leading-[1.65] text-[#52605A]">
          This changes only optional marketing consent. It does not affect any
          HireCall account or hiring process.
        </p>
        <form action={withdrawMarketingDemoLeadAction} className="mt-7">
          <input name="token" type="hidden" value={token ?? ""} />
          <button
            className="h-12 rounded-full bg-[#0B2E26] px-7 font-title font-medium text-white"
            type="submit"
          >
            Unsubscribe me
          </button>
        </form>
      </div>
    </main>
  );
}

function Message({ body, title }: { body: string; title: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#F4F3EF] px-6 text-center text-[#151A17]">
      <div className="max-w-[560px]">
        <h1 className="font-display text-[48px] leading-[1.02]">{title}</h1>
        <p className="mt-5 text-[16px] leading-[1.65] text-[#52605A]">{body}</p>
      </div>
    </main>
  );
}
