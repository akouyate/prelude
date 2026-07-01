"use client";

import * as React from "react";
import { Check, Copy } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { cn } from "@prelude/ui";

export function CopyCandidateLinkButton({
  candidatePath,
  children,
}: {
  candidatePath: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    await navigator.clipboard?.writeText(`${origin}${candidatePath}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [candidatePath]);

  return (
    <button
      className={cn(
        "inline-flex h-[42px] max-w-[280px] cursor-pointer items-center justify-center gap-[9px] rounded-full border px-3.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
        copied
          ? "border-[#cdd9b6] bg-[#eef0e3] text-olive-950"
          : "border-[#ddd8cc] bg-white text-ink-950 hover:border-ink-950",
      )}
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <Check aria-hidden={true} className="h-[15px] w-[15px]" />
      ) : (
        <Copy aria-hidden={true} className="h-[15px] w-[15px] text-[#8a8178]" />
      )}
      <span className="truncate text-[#5b574f]">
        {copied ? t("interviewDetail.copyLinkCopied") : children}
      </span>
    </button>
  );
}
