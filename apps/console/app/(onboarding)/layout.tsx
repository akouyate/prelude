import type { ReactNode } from "react";
import { BrandMark } from "@prelude/ui";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(115deg,#f6f3ec_0%,#fbfaf7_48%,#f1f3e6_100%)] text-ink-900">
      <header className="relative z-10 border-b border-ink-100 bg-[#fbfaf7]/72 px-5 py-3 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <BrandMark />
          <div className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white">
            A
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
