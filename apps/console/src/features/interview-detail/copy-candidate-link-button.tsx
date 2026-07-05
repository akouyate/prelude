"use client";

import * as React from "react";
import { Check, Copy } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@prelude/ui";

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
    <Button
      className={cn(
        "h-[42px] max-w-[280px] gap-[9px] px-3.5 text-[13px] font-semibold",
        copied && "border-[#cdd9b6] bg-[#eef0e3] text-olive-950",
      )}
      onClick={handleCopy}
      type="button"
      variant="secondary"
    >
      {copied ? (
        <Check aria-hidden={true} className="h-[15px] w-[15px]" />
      ) : (
        <Copy aria-hidden={true} className="h-[15px] w-[15px] text-[#8a8178]" />
      )}
      <span className="truncate">
        {copied ? t("interviewDetail.copyLinkCopied") : children}
      </span>
    </Button>
  );
}
