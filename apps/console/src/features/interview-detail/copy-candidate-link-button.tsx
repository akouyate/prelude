"use client";

import * as React from "react";
import { Check, Copy } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Button, cn, useToast } from "@prelude/ui";

import { candidateAppUrl } from "../../libs/candidate-app-url";
import { copyTextToClipboard } from "../../libs/clipboard";

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
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    const copiedOk = await copyTextToClipboard(candidateAppUrl(candidatePath));
    if (!copiedOk) {
      toast({
        dismissLabel: t("toast.dismiss"),
        message: t("toast.copyLinkFailed"),
        tone: "danger",
      });
      return;
    }

    // The Copy→Check icon/label swap below stays — the toast adds
    // discoverability, it does not replace that tight local loop.
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    toast({
      dismissLabel: t("toast.dismiss"),
      message: t("toast.copyLinkCopied"),
      tone: "success",
    });
  }, [candidatePath, t, toast]);

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
