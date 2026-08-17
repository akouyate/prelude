"use client";

import * as React from "react";
import { Toast as BaseToast } from "@base-ui-components/react/toast";
import { Xmark } from "iconoir-react";

import { cn } from "../lib/cn";
import { Toast } from "./toast";

/**
 * A thin, styled orchestration layer around Base UI's headless `Toast`
 * primitive (already a dependency here — see `dialog.tsx`/`drawer.tsx` for
 * the same pattern) and this package's own `Toast` card. Base UI supplies the
 * mechanics that are easy to get subtly wrong by hand: the auto-dismiss timer
 * (paused on hover/focus/window-blur for free), the portal, and an ARIA live
 * region that announces toasts to screen readers independently of what is
 * visually rendered. This file supplies none of that logic itself — only the
 * visual tones and the small `useToast()` call-site ergonomics.
 */

export type ToastTone = "danger" | "info" | "success" | "warning";

export type ToastOptions = {
  tone?: ToastTone;
  message: React.ReactNode;
  /**
   * Milliseconds before the toast auto-dismisses. Omit for the ~6s default;
   * pass `null` for an outcome the reader must actually see, which then stays
   * until they dismiss it by hand.
   */
  duration?: number | null;
  /** Accessible label for the dismiss control. This package carries no i18n
   * of its own, so the caller supplies the translated string. */
  dismissLabel: string;
};

type ToastData = { dismissLabel: string };

const DEFAULT_DURATION_MS = 6000;

const toneClasses: Record<ToastTone, string> = {
  danger: "border-coral-100 bg-coral-50/95 text-coral-800",
  info: "border-ink-100 bg-white/86 text-ink-800",
  success: "border-[#dfe7ca] bg-[#f7f9ef]/95 text-olive-900",
  warning: "border-gold-100 bg-[#fff8e6]/95 text-gold-800",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <BaseToast.Provider timeout={DEFAULT_DURATION_MS}>
      {children}
      <BaseToast.Portal>
        {/*
          Bottom-center, floating, blurred card: the same idiom this codebase
          already uses for other transient/fixed overlays anchored to the
          viewport edge (see the candidate decision bar), and the shape the
          `Toast` primitive's own styling (rounded-2xl, translucent white,
          backdrop-blur) reads as designed for — a light floating card, not a
          persistent corner control.
        */}
        <BaseToast.Viewport className="fixed inset-x-0 bottom-6 z-[70] flex flex-col-reverse items-center gap-2 px-4 outline-none">
          <ToastStack />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastStack() {
  const { toasts } = BaseToast.useToastManager();

  return toasts.map((entry) => {
    const tone = (entry.type as ToastTone | undefined) ?? "info";
    const dismissLabel = (entry.data as ToastData | undefined)?.dismissLabel ?? "Dismiss";

    return (
      <BaseToast.Root
        className="w-[min(380px,88vw)] transition-all duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 motion-reduce:transition-none"
        key={entry.id}
        toast={entry}
      >
        <Toast
          className={cn(
            "pointer-events-auto flex w-full items-start justify-between gap-3 shadow-[0_16px_44px_rgba(20,18,12,0.16)]",
            toneClasses[tone],
          )}
        >
          <BaseToast.Description className="min-w-0 flex-1">
            {entry.description}
          </BaseToast.Description>
          <BaseToast.Close
            aria-label={dismissLabel}
            className="shrink-0 cursor-pointer rounded-full p-0.5 text-current opacity-60 transition hover:opacity-100"
          >
            <Xmark className="h-4 w-4" />
          </BaseToast.Close>
        </Toast>
      </BaseToast.Root>
    );
  });
}

export function useToast() {
  const manager = BaseToast.useToastManager();

  const toast = React.useCallback(
    ({ tone = "info", message, duration, dismissLabel }: ToastOptions) =>
      manager.add<ToastData>({
        data: { dismissLabel },
        description: message,
        timeout: duration === null ? 0 : (duration ?? DEFAULT_DURATION_MS),
        type: tone,
      }),
    [manager],
  );

  return { dismiss: manager.close, toast };
}
