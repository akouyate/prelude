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
    <aside className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white/80 px-4 py-3 text-sm text-ink-700">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
          <Eye aria-hidden="true" className="h-4 w-4" />
        </span>
        <div>
          <p className="font-semibold text-ink-950">Live test preview</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-600">
            Nothing enters your candidate pipeline. Audio is transmitted live,
            but it is not recorded.
          </p>
        </div>
      </div>
      <a
        className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/80 px-4 text-sm font-medium text-ink-900 transition-colors hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
        href={returnUrl}
      >
        Exit preview
        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
      </a>
    </aside>
  );
}
