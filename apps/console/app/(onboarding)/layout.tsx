import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(105deg,#f4faf7_0%,#fbfbfa_34%,#fff8f5_100%)] text-ink-900">
      <header className="relative z-10 flex h-16 items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-ink-900 text-white">
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-[0.02em] text-ink-900">
            Prelude.ai
          </span>
        </div>
        <div className="grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white">
          A
        </div>
      </header>

      {children}
    </div>
  );
}
