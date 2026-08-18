"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@prelude/ui";

import { copyTextToClipboard } from "./clipboard";

/**
 * How long a successful copy's in-place affirmation (an icon/label swap at
 * the call site, keyed off `copiedKey` below) stays before reverting. Three
 * call sites each hand-rolled this: two agreed on 1600ms, the third drifted
 * to 2000ms without anyone deciding it should differ. This hook picks the
 * two-site number.
 */
const COPY_FEEDBACK_DURATION_MS = 1600;

/**
 * Shared by every candidate-link copy affordance (roles list, interview
 * detail, the builder's share step): copy to clipboard
 * (`copyTextToClipboard`, which stays the narrow browser-quirk helper this
 * hook is the layer above), toast success/failure, and hold a `copiedKey`
 * for a timed in-place affirmation.
 *
 * `key` identifies which target was just copied — a call site with several
 * copyable things on screen at once (the roles list) passes each row's own
 * id and compares `copiedKey === row.id`; a call site with a single target
 * can pass anything stable for that target (its own candidate path is a
 * natural choice) and compare `copiedKey === thatValue`.
 */
export function useCopyLinkFeedback() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const copy = React.useCallback(
    async (url: string, key: string) => {
      const copiedOk = await copyTextToClipboard(url);
      if (!copiedOk) {
        toast({
          dismissLabel: t("toast.dismiss"),
          message: t("toast.copyLinkFailed"),
          tone: "danger",
        });
        return;
      }

      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_DURATION_MS);
      toast({
        dismissLabel: t("toast.dismiss"),
        message: t("toast.copyLinkCopied"),
        tone: "success",
      });
    },
    [t, toast],
  );

  return { copiedKey, copy };
}
