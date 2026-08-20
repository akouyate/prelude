import type { Metadata } from "next";

import { MarketingDemoLauncher } from "../../../src/features/marketing-demo/marketing-demo-launcher";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description:
    "Try a private, candidate-style HireCall voice interview using a predefined demo role.",
  title: "Try a live interview · HireCall",
};

export default function MarketingDemoPage() {
  const returnTarget = new URL(
    "/demo/result",
    process.env.NEXT_PUBLIC_CONSOLE_URL ?? "http://localhost:3000",
  ).toString();

  return (
    <MarketingDemoLauncher
      returnTarget={returnTarget}
      turnstileSiteKey={
        process.env.NEXT_PUBLIC_MARKETING_DEMO_TURNSTILE_SITE_KEY ?? ""
      }
    />
  );
}
