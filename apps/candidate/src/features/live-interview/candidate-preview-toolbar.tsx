"use client";

import { ArrowUpRight, Eye } from "iconoir-react";

export function CandidatePreviewToolbar({
  returnPath,
}: {
  returnPath: string;
}) {
  const consoleOrigin =
    process.env.NEXT_PUBLIC_CONSOLE_URL ?? "http://localhost:3000";
  const returnUrl = new URL(returnPath, consoleOrigin).toString();

  return (
    <aside className="mx-[clamp(1.125rem,5vw,2.75rem)] mt-[1.375rem] flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-ink-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
          <Eye aria-hidden="true" className="h-4 w-4" />
        </span>
        <div>
          <p className="font-title text-[14.5px] font-semibold tracking-[-0.008em] text-ink-950">
            Live test preview
          </p>
          <p className="mt-0.5 text-[13px] leading-[1.5] text-ink-600">
            Nothing enters your candidate pipeline. Audio is transmitted live,
            but it is not recorded.
          </p>
        </div>
      </div>
      <a
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-ink-300 bg-paper-sunken px-4 font-title text-[13.5px] font-medium text-ink-950 transition-colors hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spruce-300"
        href={returnUrl}
      >
        Exit preview
        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
      </a>
    </aside>
  );
}
