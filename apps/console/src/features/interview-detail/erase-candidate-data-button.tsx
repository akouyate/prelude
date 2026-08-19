"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, useToast } from "@prelude/ui";
import { Xmark } from "iconoir-react";

import { eraseCandidateDataAction } from "../../server/interviews/candidate-erasure-actions";

/**
 * The controller's own execution of the right to erasure.
 *
 * A `window.confirm` (what the recording-only delete uses) cannot carry this
 * decision: the recruiter has to be told, before confirming, exactly what
 * disappears AND exactly what survives — the Art. 17(3) tombstone is part of the
 * promise made to the candidate, so an operator who does not know it is there
 * cannot answer for it. Hence a real dialog with both lists.
 */
export function EraseCandidateDataButton({
  candidateLabel,
  candidateSessionId,
  canErase,
}: {
  candidateLabel: string;
  candidateSessionId: string;
  canErase: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Owners and admins only, mirrored server-side by `canEraseCandidateData` —
  // this hidden button is an affordance, never the gate.
  if (!canErase) {
    return null;
  }

  const onConfirm = () => {
    startTransition(() => {
      eraseCandidateDataAction({ candidateSessionId })
        .then(() => {
          setOpen(false);
          toast({
            dismissLabel: t("toast.dismiss"),
            message: t("erasure.toastSuccess"),
            tone: "success",
          });
        })
        .catch(() => {
          setOpen(false);
          toast({
            dismissLabel: t("toast.dismiss"),
            duration: null,
            message: t("erasure.toastFailed"),
            tone: "danger",
          });
        });
    });
  };

  return (
    <>
      <button
        className="cursor-pointer text-[12px] font-medium text-[#a29b8d] transition hover:text-red-600 disabled:cursor-default disabled:opacity-60"
        disabled={pending}
        onClick={() => setOpen(true)}
        type="button"
      >
        {pending ? t("erasure.pending") : t("erasure.action")}
      </button>
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink-950/25 backdrop-blur-[2px]" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-[#e7e2d8] bg-[#f9f8f3] shadow-2xl outline-none">
            <div className="flex items-start justify-between gap-5 border-b border-[#e7e2d8] px-6 py-5">
              <div>
                <Dialog.Title className="text-lg font-semibold text-ink-950">
                  {t("erasure.dialogTitle")}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-ink-600">
                  {t("erasure.dialogIntro", { candidate: candidateLabel })}
                </Dialog.Description>
              </div>
              <button
                aria-label={t("erasure.cancel")}
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-500 transition hover:bg-white hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                onClick={() => setOpen(false)}
                type="button"
              >
                <Xmark aria-hidden={true} className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-[1.6] text-ink-700">
                <li>{t("erasure.deletesTranscript")}</li>
                <li>{t("erasure.deletesBrief")}</li>
                <li>{t("erasure.deletesIdentity")}</li>
              </ul>

              <p className="mt-4 text-sm font-medium text-ink-950">
                {t("erasure.keepsIntro")}
              </p>
              <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-sm leading-[1.6] text-ink-700">
                <li>{t("erasure.keepsRecord")}</li>
                <li>{t("erasure.keepsBilling")}</li>
              </ul>

              <p className="mt-4 text-sm font-semibold text-[#8a3a26]">
                {t("erasure.irreversible")}
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#e7e2d8] px-6 py-4">
              <Button
                className="h-10 rounded-xl"
                disabled={pending}
                onClick={() => setOpen(false)}
                type="button"
                variant="secondary"
              >
                {t("erasure.cancel")}
              </Button>
              <Button
                className="h-10 rounded-xl bg-[#8a3a26] text-white hover:bg-[#75311f]"
                disabled={pending}
                onClick={onConfirm}
                type="button"
              >
                {pending ? t("erasure.pending") : t("erasure.confirm")}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
