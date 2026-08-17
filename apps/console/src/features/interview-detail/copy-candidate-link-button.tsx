"use client";

import * as React from "react";
import { Check, Copy } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@prelude/ui";

import { candidateAppUrl } from "../../libs/candidate-app-url";
import { useCopyLinkFeedback } from "../../libs/use-copy-link-feedback";

export function CopyCandidateLinkButton({
  candidatePath,
  children,
  className,
}: {
  candidatePath: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const { copiedKey, copy } = useCopyLinkFeedback();
  // The Copy→Check icon/label swap below stays — the toast adds
  // discoverability, it does not replace that tight local loop.
  const copied = copiedKey === candidatePath;

  const handleCopy = React.useCallback(async () => {
    await copy(candidateAppUrl(candidatePath), candidatePath);
  }, [candidatePath, copy]);

  return (
    <Button
      className={cn(
        "h-[42px] max-w-[280px] gap-[9px] px-3.5 text-[13px] font-semibold",
        copied && "border-[#cdd9b6] bg-[#eef0e3] text-olive-950",
        className,
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
