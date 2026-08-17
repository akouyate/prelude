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
          // `Toast.Viewport` already renders role="region" aria-live="polite"
          // aria-relevant="additions text" (base-ui: toast/viewport/ToastViewport.js) —
          // it is the sole announcer for this stack. `Toast`'s own role="status"
          // is spread-overridable (toast.tsx applies {...props} after the
          // hardcoded role), so it is overridden here to avoid nesting a second
          // live region inside the first, which is the WAI-ARIA anti-pattern
          // that made VoiceOver double-announce.
          role="presentation"
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

  // `manager` is a NEW object every render whose identity is tied to Base
  // UI's `toasts` array (`useToastManager` is memoised on
  // `[toasts, add, close, update, promise]`), and `toasts` gets a new array
  // reference on every add/close/update ANYWHERE toasts are used in the app.
  // Consumers legitimately put `toast` in a `useEffect` dependency array —
  // "announce this outcome once" is exactly an effect's job — so `toast`'s
  // own identity must not ride along with that churn: an unstable `toast`
  // reference re-runs every effect that depends on it every time ANY toast
  // fires anywhere, including its own, which fires another toast, which
  // changes the reference again — an infinite loop (reproduced: 27 toasts in
  // 100ms from a single mount before this fix). `managerRef` always holds the
  // latest manager, updated during render (safe — it happens before any
  // effect or callback can read it); `toast`/`dismiss` are empty-deps
  // `useCallback`s that read it at call time, so their own identity never
  // changes.
  const managerRef = React.useRef(manager);
  managerRef.current = manager;

  const toast = React.useCallback(
    ({ tone = "info", message, duration, dismissLabel }: ToastOptions): void => {
      // Explicitly `void`, not inferred: `add()` below returns the created
      // toast's id, but the `queueMicrotask` deferral means that id doesn't
      // exist yet when this function returns — there is nothing synchronous
      // left to hand back. No call site relies on a return value today (and
      // `dismiss()` is unused), so this just makes the compiler enforce what
      // the code already does. A future programmatic-dismiss or
      // promise-toast API that needs the id would have to generate it
      // caller-side and pass it in as part of `ToastOptions`, not read it
      // off this call's return.
      //
      // Every real call site fires this from a useEffect (an outcome arriving,
      // a copy succeeding, an invite being created) — never a render body. That
      // still isn't safe to call synchronously: React keeps CommitContext on
      // the stack for the whole passive-effect flush, and the new toast's
      // Toast.Root measures itself in a layout effect that calls
      // ReactDOM.flushSync (base-ui: toast/root/ToastRoot.js's
      // `recalculateHeight`) as soon as it mounts. Calling `add` in the same
      // tick re-enters that still-active context — "flushSync was called from
      // inside a lifecycle method" — and once two toasts overlap, the height
      // recalculation on each mount can retrigger the next before React
      // settles, which contributed to the "Maximum update depth exceeded"
      // crash observed here (the referential-instability fix above removes
      // the other, larger contributor). Queuing the add as a microtask lets
      // the effect flush's call stack unwind first, so base-ui's own
      // flushSync lands as a fresh top-level update instead of a nested one.
      //
      // What this does NOT reach: under React StrictMode (on by default for
      // the app router since Next 13.5.1 — apps/console does not override
      // it), React double-invokes every layout effect in dev, so
      // `recalculateHeight` itself still fires twice per toast and each
      // invocation's flushSync still warns — a bounded, non-growing pair per
      // toast, confirmed by firing multiple toasts in a row and watching the
      // count stay exactly 2-per-toast, never compounding. That pair lives
      // entirely inside base-ui's own layout effect, not in any code this
      // file calls synchronously, doesn't happen in production (StrictMode's
      // double-invoke is dev-only), and doesn't happen in this file's own
      // test below (no StrictMode wrapper there) — so there is nothing left
      // on this side of the call to defer further.
      queueMicrotask(() => {
        managerRef.current.add<ToastData>({
          data: { dismissLabel },
          description: message,
          timeout: duration === null ? 0 : (duration ?? DEFAULT_DURATION_MS),
          type: tone,
        });
      });
    },
    [],
  );

  const dismiss = React.useCallback((id: string) => {
    managerRef.current.close(id);
  }, []);

  return { dismiss, toast };
}
